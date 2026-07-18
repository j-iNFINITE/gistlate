import { countSentenceMarks } from '../subtitles/sentence-marks'

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu

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

  if (sourceLength >= 80 && targetLength / sourceLength < 0.28) {
    throw new Error('Canonical target is too short for complete source coverage')
  }

  const sourceStops = countSentenceMarks(source)
  const targetStops = countSentenceMarks(target)
  if (sourceStops >= 4 && targetStops < Math.ceil(sourceStops * 0.4)) {
    throw new Error('Canonical target has incomplete multi-sentence coverage')
  }

  if (targetLang === 'zh-Hans') validateSimplifiedChineseTarget(target)
}

function validateSimplifiedChineseTarget(target: string): void {
  const visible = Array.from(target).filter((char) => !/[\s\p{P}\p{S}]/u.test(char)).length
  const kana = target.match(KANA_RE)?.length ?? 0
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
