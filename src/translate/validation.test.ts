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

  it('allows source-owned Katakana product names inside a Chinese translation', () => {
    expect(() => validateCanonicalTarget(
      'あとクリアパーツがはまる箇所の裏側もシルバーにして多少は見栄えくなるようにしておきましょう。',
      '另外，安装クリアパーツ的位置背面也涂成シルバー，让外观看起来更好一些。',
      'zh-Hans',
    )).not.toThrow()
  })

  it('rejects a severe summary that omits most of a long source paragraph', () => {
    const source = Array.from({ length: 12 }, (_, index) => `これは重要な説明${index}です。`).join('')
    expect(() => validateCanonicalTarget(source, '这是最后一句说明。', 'zh-Hans'))
      .toThrow(/incomplete|short|coverage/i)
  })

  it.each([
    [
      'These just make your decal life much easier with Mark Setter acting as a wet adhesive when dried and Mark softer being a solution to make the decals adhere to the shape of the plastic much easier, which is really useful if you ever have a decal that needs to go around a corner but refuses to stick on around that corner.',
      'Mark Setter干后提供湿黏性；Mark Softer软化水贴，使其更易贴合塑料形状，尤其能让水贴服帖转角。',
    ],
    [
      'I wanted to give it pink panel lines and yeah, I think it gave it such a great look and I thought it was very much worth the money.',
      '我想做粉色渗线，效果很棒，很值。',
    ],
    [
      "So, it just comes with this cover, which I actually don't really use that often, but it is good to protect your nippers.",
      '只带这个保护套；我不常用，但它能保护剪钳。',
    ],
    [
      "It's probably my most hated process here cuz it just takes so dang long and you have to be so precise.",
      '这步我最讨厌，太耗时还得很精准。',
    ],
    [
      "This is just Kryon matte top coat, but if you wanted something better, you'd use something like this.",
      '这是Kryon哑光罩面漆；想要更好的，就用这种。',
    ],
  ])('accepts a complete naturally compressed English-to-Chinese translation', (source, target) => {
    expect(() => validateCanonicalTarget(source, target, 'zh-Hans')).not.toThrow()
  })

  it('still rejects a severely incomplete English-to-Chinese target', () => {
    const source = 'I wanted to give it pink panel lines and yeah, I think it gave it such a great look and I thought it was very much worth the money.'
    expect(() => validateCanonicalTarget(source, '我想做粉色渗线。', 'zh-Hans'))
      .toThrow(/incomplete|short|coverage/i)
  })
})
