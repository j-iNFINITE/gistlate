import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TranslationMode } from '../settings'
import {
  addOperationUsageResponse,
  addUsageResponse,
  emptyOperationUsage,
  emptyUsageAggregate,
  type RequestUsage,
  type TranslationOperationUsage,
  type UsageAggregate,
  type UsageStage,
} from './contracts'
import { calculateCostCny, type PricingSnapshot } from './pricing'

const DB_NAME = 'gistlate-usage'
const DB_VERSION = 1
const OPERATIONS = 'operations'
const TOTALS = 'totals'
const MAX_PER_VIDEO = 20
const MAX_GLOBAL = 2000

export type UsageOperationStatus = 'running' | 'success' | 'failed' | 'aborted'

export interface UsageStrategy {
  mode: TranslationMode
  configuredBatchSize: number
}

export interface UsageOperation {
  operationId: string
  videoId: string
  src: string
  tgt: string
  baseUrl: string
  model: string
  force: boolean
  strategy: UsageStrategy
  status: UsageOperationStatus
  startedAt: number
  endedAt?: number
  usage: TranslationOperationUsage
  pricing?: PricingSnapshot
  costCny?: number
  error?: string
}

export interface VideoUsageTotal {
  videoId: string
  startedOperations: number
  successOperations: number
  failedOperations: number
  abortedOperations: number
  usage: UsageAggregate
  costCny?: number
  costUnavailable: boolean
  updatedAt: number
}

interface UsageDB extends DBSchema {
  operations: {
    key: string
    value: UsageOperation
    indexes: { videoId: string; endedAt: number; status: UsageOperationStatus }
  }
  totals: { key: string; value: VideoUsageTotal }
}

let dbPromise: Promise<IDBPDatabase<UsageDB>> | undefined

function getDb(): Promise<IDBPDatabase<UsageDB>> {
  if (!dbPromise) {
    dbPromise = openDB<UsageDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(OPERATIONS)) {
          const store = db.createObjectStore(OPERATIONS, { keyPath: 'operationId' })
          store.createIndex('videoId', 'videoId')
          store.createIndex('endedAt', 'endedAt')
          store.createIndex('status', 'status')
        }
        if (!db.objectStoreNames.contains(TOTALS)) {
          db.createObjectStore(TOTALS, { keyPath: 'videoId' })
        }
      },
    })
  }
  return dbPromise
}

function operationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function emptyVideoTotal(videoId: string, now: number): VideoUsageTotal {
  return {
    videoId,
    startedOperations: 0,
    successOperations: 0,
    failedOperations: 0,
    abortedOperations: 0,
    usage: emptyUsageAggregate(),
    costUnavailable: false,
    updatedAt: now,
  }
}

export async function beginUsageOperation(
  input: Omit<UsageOperation, 'operationId' | 'status' | 'startedAt' | 'usage' | 'costCny' | 'endedAt'>,
): Promise<UsageOperation> {
  const db = await getDb()
  const now = Date.now()
  const operation: UsageOperation = {
    ...input,
    operationId: operationId(),
    status: 'running',
    startedAt: now,
    usage: emptyOperationUsage(),
  }
  const tx = db.transaction([OPERATIONS, TOTALS], 'readwrite')
  const current = await tx.objectStore(TOTALS).get(input.videoId) ?? emptyVideoTotal(input.videoId, now)
  current.startedOperations += 1
  current.updatedAt = now
  await tx.objectStore(OPERATIONS).add(operation)
  await tx.objectStore(TOTALS).put(current)
  await tx.done
  return operation
}

export async function appendUsageResponse(
  id: string,
  stage: UsageStage,
  usage?: RequestUsage,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction([OPERATIONS, TOTALS], 'readwrite')
  const operations = tx.objectStore(OPERATIONS)
  const operation = await operations.get(id)
  if (!operation || operation.status !== 'running') {
    tx.abort()
    throw new Error(`Usage operation is not running: ${id}`)
  }
  operation.usage = addOperationUsageResponse(operation.usage, stage, usage)
  const totals = tx.objectStore(TOTALS)
  const total = await totals.get(operation.videoId) ?? emptyVideoTotal(operation.videoId, Date.now())
  total.usage = addUsageResponse(total.usage, usage)
  total.updatedAt = Date.now()
  await operations.put(operation)
  await totals.put(total)
  await tx.done
}

export async function finalizeUsageOperation(
  id: string,
  status: Exclude<UsageOperationStatus, 'running'>,
  error?: string,
): Promise<UsageOperation | undefined> {
  const db = await getDb()
  const tx = db.transaction([OPERATIONS, TOTALS], 'readwrite')
  const operations = tx.objectStore(OPERATIONS)
  const operation = await operations.get(id)
  if (!operation || operation.status !== 'running') {
    await tx.done
    return operation
  }
  const now = Date.now()
  operation.status = status
  operation.endedAt = now
  operation.error = error ? error.slice(0, 240) : undefined
  operation.costCny = calculateCostCny(operation.usage.tokens, operation.pricing)

  const totals = tx.objectStore(TOTALS)
  const total = await totals.get(operation.videoId) ?? emptyVideoTotal(operation.videoId, now)
  if (status === 'success') total.successOperations += 1
  if (status === 'failed') total.failedOperations += 1
  if (status === 'aborted') total.abortedOperations += 1
  if (operation.costCny === undefined && operation.usage.requestCount > 0) {
    total.costUnavailable = true
  } else if (operation.costCny !== undefined) {
    total.costCny = (total.costCny ?? 0) + operation.costCny
  }
  total.updatedAt = now
  await operations.put(operation)
  await totals.put(total)
  await tx.done
  await pruneUsageDetails()
  return operation
}

/** Mark page-crash leftovers terminal without inventing requests or usage. */
export async function reconcileStaleUsageOperations(): Promise<number> {
  const db = await getDb()
  const running = await db.getAllFromIndex(OPERATIONS, 'status', 'running')
  for (const operation of running) {
    await finalizeUsageOperation(operation.operationId, 'aborted', 'Interrupted before completion')
  }
  return running.length
}

export async function getVideoUsage(videoId: string): Promise<{
  total?: VideoUsageTotal
  operations: UsageOperation[]
}> {
  const db = await getDb()
  const operations = await db.getAllFromIndex(OPERATIONS, 'videoId', videoId)
  operations.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  return { total: await db.get(TOTALS, videoId), operations }
}

export function selectRetainedOperationIds(operations: UsageOperation[]): Set<string> {
  const completed = operations.filter((operation) => operation.status !== 'running')
  const byVideo = new Map<string, UsageOperation[]>()
  for (const operation of completed) {
    const list = byVideo.get(operation.videoId) ?? []
    list.push(operation)
    byVideo.set(operation.videoId, list)
  }
  const retained: UsageOperation[] = []
  for (const list of byVideo.values()) {
    list.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    retained.push(...list.slice(0, MAX_PER_VIDEO))
  }
  retained.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  return new Set(retained.slice(0, MAX_GLOBAL).map((operation) => operation.operationId))
}

async function pruneUsageDetails(): Promise<void> {
  const db = await getDb()
  const operations = await db.getAll(OPERATIONS)
  const retained = selectRetainedOperationIds(operations)
  const tx = db.transaction(OPERATIONS, 'readwrite')
  for (const operation of operations) {
    if (operation.status !== 'running' && !retained.has(operation.operationId)) {
      await tx.store.delete(operation.operationId)
    }
  }
  await tx.done
}

/** Usage history is cleared only through this explicit API, never by subtitle cache cleanup. */
export async function clearUsageHistory(videoId?: string): Promise<void> {
  const db = await getDb()
  if (!videoId) {
    const tx = db.transaction([OPERATIONS, TOTALS], 'readwrite')
    await tx.objectStore(OPERATIONS).clear()
    await tx.objectStore(TOTALS).clear()
    await tx.done
    return
  }
  const tx = db.transaction([OPERATIONS, TOTALS], 'readwrite')
  const operations = await tx.objectStore(OPERATIONS).index('videoId').getAll(videoId)
  for (const operation of operations) {
    await tx.objectStore(OPERATIONS).delete(operation.operationId)
  }
  await tx.objectStore(TOTALS).delete(videoId)
  await tx.done
}
