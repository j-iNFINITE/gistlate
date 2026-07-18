import { describe, expect, it } from 'vitest'
import { validateCanonicalTarget } from './validation'

describe('canonical target validation', () => {
  it('accepts a complete Simplified Chinese translation', () => {
    expect(() => validateCanonicalTarget(
      '私は模型制作を長く楽しみたいです。',
      '我想长期享受模型制作的乐趣。',
      'zh-Hans',
    )).not.toThrow()
  })

  it('rejects an unchanged Japanese source echo and a long source prefix', () => {
    const source = 'モデラーの皆様には是非作業環境の光にもこだわっていただきたい。私はZライトを5年ほど愛用しています。'
    expect(() => validateCanonicalTarget(source, source, 'zh-Hans')).toThrow(/source|Japanese|target language/i)
    expect(() => validateCanonicalTarget(source, source.slice(0, 35), 'zh-Hans')).toThrow(/source|Japanese|target language/i)
  })

  it('rejects kana-heavy output and Traditional Chinese for zh-Hans', () => {
    expect(() => validateCanonicalTarget(
      '照明について説明します。',
      'モデラーの皆様には照明も重要です。',
      'zh-Hans',
    )).toThrow(/Japanese|target language/i)
    expect(() => validateCanonicalTarget(
      '塗料の匂いが部屋に残りにくいです。',
      '塗料的氣味不易殘留在房間內。',
      'zh-Hans',
    )).toThrow(/Simplified|traditional/i)
  })

  it('rejects a severe summary that omits most of a long source paragraph', () => {
    const source = Array.from({ length: 12 }, (_, index) => `これは重要な説明${index}です。`).join('')
    expect(() => validateCanonicalTarget(source, '这是最后一句说明。', 'zh-Hans'))
      .toThrow(/incomplete|short|coverage/i)
  })
})
