/**
 * Cache key computation and GitHub repo path generation.
 */

export interface CacheKeyInput {
  videoId: string
  src: string
  tgt: string
}

/**
 * Build the internal cache key (for L1 IndexedDB).
 * Model/prompt NOT included → broad reuse across versions.
 */
export function cacheKey(input: CacheKeyInput): string {
  return `${input.videoId}|${input.src}|${input.tgt}`
}

/**
 * Shard prefix: first 2 characters of the video ID.
 * Prevents thousands of files in one directory.
 */
export function shard(videoId: string): string {
  return videoId.slice(0, 2)
}

/**
 * GitHub repo file path for the artifact.
 * data/{shard}/{videoId}.{src}-{tgt}.json
 */
export function repoPath(input: CacheKeyInput): string {
  return `data/${shard(input.videoId)}/${input.videoId}.${input.src}-${input.tgt}.json`
}
