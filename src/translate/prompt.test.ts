import { describe, it, expect } from 'vitest'
import { parseNumbered, fillPrompt, fillBoundaryPrompt } from './prompt'

describe('parseNumbered', () => {
  it('parses a well-formed response', () => {
    const out = '[1] Hello\n[2] World\n[3] Test'
    expect(parseNumbered(out, 3)).toEqual(['Hello', 'World', 'Test'])
  })

  it('handles extra whitespace', () => {
    const out = '  [1]   Hello   \n[2] World  '
    expect(parseNumbered(out, 2)).toEqual(['Hello', 'World'])
  })

  it('throws on missing slots', () => {
    const out = '[1] Hello\n[3] Test'
    expect(() => parseNumbered(out, 3)).toThrow(/missing.*\[2\]/)
  })

  it('throws on too few lines', () => {
    const out = '[1] Hello'
    expect(() => parseNumbered(out, 3)).toThrow(/missing/)
  })

  it('parses text with colons and brackets', () => {
    const out = '[1] Hello: world\n[2] Test [foo] bar'
    expect(parseNumbered(out, 2)).toEqual(['Hello: world', 'Test [foo] bar'])
  })

  it('handles empty output', () => {
    expect(() => parseNumbered('', 1)).toThrow(/missing/)
  })

  it('handles reordered output', () => {
    const out = '[2] Second\n[1] First'
    const result = parseNumbered(out, 2)
    expect(result[0]).toBe('First')
    expect(result[1]).toBe('Second')
  })
})

describe('fillPrompt', () => {
  it('fills system prompt with target language and count', () => {
    const { system } = fillPrompt(['hello', 'world'], 'zh-Hans')
    expect(system).toContain('Simplified Chinese')
    expect(system).toContain('2 lines')
  })

  it('instructs the model to translate the lines as one coherent transcript', () => {
    const { system } = fillPrompt(['hello', 'world'], 'es')
    const lower = system.toLowerCase()
    expect(lower).toContain('consecutive')
    expect(lower).toContain('single video')
    expect(lower).toContain('consistent')
  })

  it('fills user prompt with numbered text', () => {
    const { user } = fillPrompt(['hello', 'world'], 'es')
    expect(user).toContain('[1] hello')
    expect(user).toContain('[2] world')
    expect(user).toContain('Spanish')
  })

  it('uses custom prompt that replaces all placeholders', () => {
    const custom = 'Target: {{Target Language}}, Count: {{Segment Count}}, Text:\n{{Text}}'
    const { user, system } = fillPrompt(['a', 'b', 'c'], 'ja', custom)
    expect(system).toContain('Target: Japanese')
    expect(system).toContain('Count: 3')
    expect(system).toContain('[1] a')
    expect(user).toBe('[1] a\n[2] b\n[3] c')
  })
})

describe('fillBoundaryPrompt', () => {
  it('describes the E/C boundary output and fragment count, and does not ask to translate', () => {
    const { system } = fillBoundaryPrompt(['a', 'b', 'c'])
    expect(system).toContain('[<n>] E')
    expect(system).toContain('[<n>] C')
    expect(system).toContain('1 to 3') // cover every fragment from 1 to N
    const lower = system.toLowerCase()
    expect(lower).toContain('sentence')
    expect(lower).toContain('do not translate')
  })

  it('numbers the fragments in the user message', () => {
    const { user } = fillBoundaryPrompt(['hello', 'world'])
    expect(user).toContain('[1] hello')
    expect(user).toContain('[2] world')
  })
})
