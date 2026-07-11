import { langName } from './lang'

export const SYSTEM_PROMPT_TEMPLATE = `You are a subtitle translator. You receive numbered lines and return their translations in {{Target Language}}, nothing else.

Rules:
- Output ONLY translated lines in the format [N] translated text.
- Every line MUST contain a translation in {{Target Language}}. If unsure, provide your best guess. Never output meta-text about the source or the translation process.
- If a line is a sentence fragment, translate it as-is. Do NOT complete, merge, or rearrange lines.
- If the original text lacks punctuation (common in auto-generated captions), add appropriate punctuation in the translation.
- If the text contains HTML tags, place them appropriately in the translation.
- Keep proper nouns, code, and untranslatable content in their original form.
- Input has {{Segment Count}} lines from [1] to {{Segment Count}}. Output MUST have exactly {{Segment Count}} lines with matching numbers.`

export const USER_PROMPT_TEMPLATE = `Translate to {{Target Language}}:

{{Text}}`

export function fillPrompt(
  text: string[],
  targetLang: string,
  customPrompt?: string,
): { system: string; user: string } {
  const langName_ = langName(targetLang)
  const numbered = text.map((t, i) => `[${i + 1}] ${t}`).join('\n')
  const count = text.length

  if (customPrompt) {
    const filled = customPrompt
      .replaceAll('{{Target Language}}', langName_)
      .replaceAll('{{Segment Count}}', String(count))
      .replaceAll('{{Text}}', numbered)
    return { system: filled, user: numbered }
  }

  return {
    system: SYSTEM_PROMPT_TEMPLATE
      .replaceAll('{{Target Language}}', langName_)
      .replaceAll('{{Segment Count}}', String(count)),
    user: USER_PROMPT_TEMPLATE
      .replaceAll('{{Target Language}}', langName_)
      .replaceAll('{{Text}}', numbered),
  }
}

/**
 * Parse the numbered LLM output back into string[].
 * Expected format: [1] text\n[2] text\n...
 * Throws on mismatch.
 */
export function parseNumbered(output: string, expectedCount: number): string[] {
  const results: string[] = new Array(expectedCount).fill('')
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/^\s*\[(\d+)\]\s*(.*)$/)
    if (match) {
      const index = Number.parseInt(match[1], 10) - 1
      if (index >= 0 && index < expectedCount) {
        results[index] = match[2].trim()
      }
    }
  }

  const missing = results
    .map((r, i) => (r === '' ? i + 1 : null))
    .filter((i): i is number => i !== null)

  if (missing.length > 0) {
    throw new Error(
      `Translation count mismatch: expected ${expectedCount}, missing slots: [${missing.join(', ')}]`,
    )
  }

  return results
}
