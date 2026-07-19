import { describe, expect, it } from 'vitest'
import { formatDuration, translationModeLabel } from './translation-guard-dialog'

describe('translation guard presentation', () => {
  it('formats bounded caption spans without monetary or request estimates', () => {
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatDuration(45 * 60_000 + 1_000)).toBe('45 分钟 1 秒')
    expect(formatDuration((2 * 60 + 18) * 60_000)).toBe('2 小时 18 分钟')
    expect(formatDuration(null)).toBe('未知')
  })

  it('describes only the selected request strategy', () => {
    expect(translationModeLabel('sentence', 8)).toBe('一句一次')
    expect(translationModeLabel('batch', 12)).toBe('每批 12 句')
    expect(translationModeLabel('whole', 8)).toBe('全量一次')
  })
})
