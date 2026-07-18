import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { Cue } from '../subtitles/timedtext'
import type { TranslationMode } from '../settings'
import type { TranslationOperationUsage } from '../usage/contracts'
import type { PricingSnapshot } from '../usage/pricing'

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
  generation?: GenerationMetadata
}

export interface GenerationMetadata {
  strategy: {
    mode: TranslationMode
    configuredBatchSize: number
    effectiveRequestCount: number
    concurrency: number
    temperature: 0
    boundaryMethod: 'timed-punctuation' | 'llm'
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
