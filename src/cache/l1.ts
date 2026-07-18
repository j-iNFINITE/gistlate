import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { Cue } from '../subtitles/timedtext'
import type { TranslationMode } from '../settings'
import type { TranslationOperationUsage } from '../usage/contracts'
import type { PricingSnapshot } from '../usage/pricing'
import type { CaptionTrackKind } from '../subtitles/tracks'

const DB_NAME = 'gistlate'
const DB_VERSION = 1
const STORE_NAME = 'videos'

const MAX_ENTRIES = 500
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export interface CacheEntry {
  key: string
  videoId: string
  src: string
  tgt: string
  model: string
  cues: Cue[]
  createdAt: number
  video?: { title?: string }
  track?: {
    languageCode: string
    kind: CaptionTrackKind
    vssId: string
    sourceFingerprint: string
  }
  generation?: GenerationMetadata
}

export interface GenerationMetadata {
  strategy: {
    mode: TranslationMode
    configuredBatchSize: number
    effectiveRequestCount: number
    concurrency: number
    temperature: 0
    boundaryMethod: 'manual-cues' | 'timed-punctuation' | 'llm'
    boundaryRequestCount: number
    boundaryThinking: 'enabled' | 'not-used'
    translationThinking: 'disabled'
  }
  alignment: {
    requestCount: number
    fallbackSentenceCount: number
  }
  usage?: TranslationOperationUsage
  pricing?: PricingSnapshot
  costCny?: number
}

let dbPromise: Promise<IDBPDatabase> | undefined

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
          store.createIndex('createdAt', 'createdAt')
        }
      },
    })
  }
  return dbPromise
}

export async function getL1(key: string): Promise<CacheEntry | undefined> {
  const db = await getDb()
  const entry = await db.get(STORE_NAME, key)
  if (!entry) return undefined

  // Age check
  if (Date.now() - entry.createdAt > MAX_AGE_MS) {
    await db.delete(STORE_NAME, key)
    return undefined
  }
  return entry
}

/** List valid, unexpired local artifacts newest-first for the subtitle library. */
export async function listL1(): Promise<CacheEntry[]> {
  const db = await getDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const index = tx.store.index('createdAt')
  const entries: CacheEntry[] = []
  let cursor = await index.openCursor(null, 'prev')
  const now = Date.now()
  while (cursor) {
    const value = cursor.value as unknown
    if (isCacheEntry(value)) {
      if (now - value.createdAt > MAX_AGE_MS) await cursor.delete()
      else entries.push(value)
    }
    cursor = await cursor.continue()
  }
  await tx.done
  return entries
}

export async function putL1(entry: CacheEntry): Promise<void> {
  const db = await getDb()
  await db.put(STORE_NAME, { ...entry, createdAt: entry.createdAt ?? Date.now() })

  // Opportunistic eviction: remove oldest entries beyond MAX_ENTRIES
  const count = await db.count(STORE_NAME)
  if (count > MAX_ENTRIES) {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const index = tx.store.index('createdAt')
    let cursor = await index.openCursor()
    let excess = count - MAX_ENTRIES
    while (cursor && excess > 0) {
      await cursor.delete()
      excess--
      cursor = await cursor.continue()
    }
    await tx.done
  }
}

export async function clearL1(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE_NAME)
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CacheEntry>
  return typeof entry.key === 'string' && typeof entry.videoId === 'string' &&
    typeof entry.src === 'string' && typeof entry.tgt === 'string' &&
    typeof entry.model === 'string' && typeof entry.createdAt === 'number' &&
    Number.isFinite(entry.createdAt) && Array.isArray(entry.cues) &&
    entry.cues.every((cue) => Boolean(cue) && typeof cue.o === 'string' &&
      typeof cue.s === 'number' && Number.isFinite(cue.s) &&
      typeof cue.d === 'number' && Number.isFinite(cue.d))
}
