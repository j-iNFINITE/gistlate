import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../net/gm', () => ({ gmFetch: vi.fn() }))
import { gmFetch } from '../net/gm'
import { boundaryBatch, completePrompt, translateBatch } from './openai'

const mockGmFetch = vi.mocked(gmFetch)
const DEEPSEEK = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' }

function ok(content: string, usage?: Record<string, unknown>) {
  return {
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('request profiles and usage propagation', () => {
  it('enables high-effort thinking for official DeepSeek boundary calls without sampling fields', async () => {
    mockGmFetch.mockResolvedValue(ok('[1] E'))
    await boundaryBatch(['hello'], DEEPSEEK, 'key')
    const body = JSON.parse(mockGmFetch.mock.calls[0][0].body as string)
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('disables thinking and sets temperature 0 for translation, leaving top_p absent', async () => {
    mockGmFetch.mockResolvedValue(ok('[1] 你好'))
    await translateBatch(['hello'], 'zh-Hans', DEEPSEEK, 'key', undefined, 1)
    const body = JSON.parse(mockGmFetch.mock.calls[0][0].body as string)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('top_p')
  })

  it('requests JSON output only for official DeepSeek alignment', async () => {
    mockGmFetch.mockResolvedValue(ok('{"S001":[2]}'))
    await completePrompt('system', 'user', DEEPSEEK, 'key', undefined, {
      role: 'alignment',
      jsonOutput: true,
    })
    const body = JSON.parse(mockGmFetch.mock.calls[0][0].body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('delivers normalized usage before the caller parses content', async () => {
    const onUsage = vi.fn()
    mockGmFetch.mockResolvedValue(ok('malformed', {
      prompt_tokens: 10,
      prompt_cache_hit_tokens: 8,
      prompt_cache_miss_tokens: 2,
      completion_tokens: 3,
      total_tokens: 13,
      completion_tokens_details: { reasoning_tokens: 1 },
    }))
    await expect(
      translateBatch(['hello'], 'zh-Hans', DEEPSEEK, 'key', undefined, 1, undefined, onUsage),
    ).rejects.toThrow(/missing/i)
    expect(onUsage).toHaveBeenCalledOnce()
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      promptCacheHitTokens: 8,
      completionTokens: 3,
      reasoningTokens: 1,
    }))
  })

  it('omits DeepSeek-only fields for an unknown proxy', async () => {
    mockGmFetch.mockResolvedValue(ok('[1] 你好'))
    await translateBatch(
      ['hello'],
      'zh-Hans',
      { baseUrl: 'https://proxy.example/v1', model: 'deepseek-v4-flash' },
      'key',
      undefined,
      1,
    )
    const body = JSON.parse(mockGmFetch.mock.calls[0][0].body as string)
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
  })
})
