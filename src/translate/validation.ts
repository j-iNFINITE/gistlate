import { countSentenceMarks } from '../subtitles/sentence-marks'

const HIRAGANA_RE = /\p{Script=Hiragana}/gu
const KATAKANA_RUN_RE = /[\p{Script=Katakana}ー]+/gu
const LATIN_RE = /\p{Script=Latin}/gu
const LATIN_WORD_RE = /[\p{Script=Latin}\p{N}]+(?:['’][\p{Script=Latin}\p{N}]+)*/gu

const MIN_LATIN_SOURCE_SHARE = 0.7
const MIN_ZH_HANS_CODE_POINTS_PER_LATIN_WORD = 0.4

// High-signal characters whose zh-Hans forms differ. This intentionally is
// not a general script converter; it catches a model returning an obviously
// Traditional-Chinese sentence and asks the model to try again.
const TRADITIONAL_ONLY_RE = /[塗氣殘間內為與這個們來時會說對從還後裡開關實體發現應該讓過種樣學長點電動網頁視頻製環聲廣東華臺萬專業]/u

/**
 * Reject canonical responses that are structurally valid but clearly are not
 * a complete translation in the requested target language.
 */
export function validateCanonicalTarget(
  source: string,
  target: string,
  targetLang: string,
): void {
  const sourceComparable = comparableText(source)
  const targetComparable = comparableText(target)
  if (!targetComparable) throw new Error('Canonical target is empty')

  const sourceLength = Array.from(sourceComparable).length
  const targetLength = Array.from(targetComparable).length

  if (sourceLength >= 20 && targetComparable === sourceComparable) {
    throw new Error('Canonical target copied the source instead of translating it')
  }
  if (
    sourceLength >= 20 &&
    targetLength >= 20 &&
    (sourceComparable.startsWith(targetComparable) || targetComparable.startsWith(sourceComparable))
  ) {
    throw new Error('Canonical target contains a long untranslated source prefix')
  }

  if (sourceLength >= 80) {
    validateLongSourceCoverage(source, sourceComparable, targetLength, targetLang)
  }

  const sourceStops = countSentenceMarks(source)
  const targetStops = countSentenceMarks(target)
  if (sourceStops >= 4 && targetStops < Math.ceil(sourceStops * 0.4)) {
    throw new Error('Canonical target has incomplete multi-sentence coverage')
  }

  if (targetLang === 'zh-Hans') validateSimplifiedChineseTarget(source, target)
}

function validateLongSourceCoverage(
  source: string,
  sourceComparable: string,
  targetLength: number,
  targetLang: string,
): void {
  const sourceLength = Array.from(sourceComparable).length
  const latinLength = sourceComparable.match(LATIN_RE)?.length ?? 0
  const latinWords = source.match(LATIN_WORD_RE)?.length ?? 0

  // Chinese normally expresses an English sentence with far fewer code points.
  // Comparing raw character counts made ordinary complete translations fail.
  // For a Latin-dominant source, word count is the more stable coverage scale;
  // this remains only a severe-omission guard, not a translation-quality score.
  if (targetLang === 'zh-Hans' && latinLength / sourceLength >= MIN_LATIN_SOURCE_SHARE) {
    if (latinWords > 0 && targetLength / latinWords < MIN_ZH_HANS_CODE_POINTS_PER_LATIN_WORD) {
      throw new Error(
        `Canonical target is too short for complete source coverage (${targetLength} target code points for ${latinWords} Latin source words)`,
      )
    }
    return
  }

  if (targetLength / sourceLength < 0.28) {
    throw new Error(
      `Canonical target is too short for complete source coverage (${targetLength}/${sourceLength} comparable code points)`,
    )
  }
}

function validateSimplifiedChineseTarget(source: string, target: string): void {
  const visible = Array.from(target).filter((char) => !/[\s\p{P}\p{S}]/u.test(char)).length
  const hiragana = target.match(HIRAGANA_RE)?.length ?? 0
  const unexplainedKatakana = (target.match(KATAKANA_RUN_RE) ?? [])
    .filter((run) => !source.includes(run))
    .reduce((total, run) => total + Array.from(run).length, 0)
  const kana = hiragana + unexplainedKatakana
  if (kana >= 4 && kana / Math.max(1, visible) > 0.08) {
    throw new Error('Canonical target is Japanese-heavy and not in the target language')
  }
  if (TRADITIONAL_ONLY_RE.test(target)) {
    throw new Error('Canonical target contains Traditional Chinese instead of Simplified Chinese')
  }
}

function comparableText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}
