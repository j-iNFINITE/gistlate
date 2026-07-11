#!/usr/bin/env node
/**
 * Dependency-free validator for the Gistlate translation pool.
 * Checks every data/**\/*.json against the artifact schema and the
 * filename/shard convention. Exits non-zero on any error.
 *
 * Usage: node scripts/validate.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = 'data'
const errors = []

const isStr = (x) => typeof x === 'string' && x.length > 0
const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

function walk(dir) {
  let out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (name.endsWith('.json')) out.push(p)
  }
  return out
}

function validateFile(path) {
  const rel = path.replace(/\\/g, '/')
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    errors.push(`${rel}: invalid JSON — ${e.message}`)
    return
  }

  for (const f of ['videoId', 'src', 'tgt', 'model']) {
    if (!isStr(data[f])) errors.push(`${rel}: missing/invalid string field "${f}"`)
  }
  if (!isNum(data.createdAt)) errors.push(`${rel}: missing/invalid number field "createdAt"`)

  if (!Array.isArray(data.cues) || data.cues.length === 0) {
    errors.push(`${rel}: "cues" must be a non-empty array`)
  } else {
    data.cues.forEach((c, i) => {
      if (!c || typeof c !== 'object') {
        errors.push(`${rel}: cues[${i}] must be an object`)
        return
      }
      if (!isNum(c.s)) errors.push(`${rel}: cues[${i}].s must be a number`)
      if (!isNum(c.d)) errors.push(`${rel}: cues[${i}].d must be a number`)
      if (!isStr(c.o)) errors.push(`${rel}: cues[${i}].o must be a non-empty string`)
      if (!isStr(c.t)) errors.push(`${rel}: cues[${i}].t must be a non-empty string`)
    })
  }

  // Filename + shard convention: data/{videoId[0:2]}/{videoId}.{src}-{tgt}.json
  if (isStr(data.videoId) && isStr(data.src) && isStr(data.tgt)) {
    const parts = rel.split('/')
    const file = parts[parts.length - 1]
    const shardDir = parts[parts.length - 2]
    const expectedFile = `${data.videoId}.${data.src}-${data.tgt}.json`
    if (file !== expectedFile) {
      errors.push(`${rel}: filename must be "${expectedFile}" (from videoId/src/tgt)`)
    }
    const expectedShard = data.videoId.slice(0, 2)
    if (shardDir !== expectedShard) {
      errors.push(`${rel}: must live under "data/${expectedShard}/" (first 2 chars of videoId)`)
    }
  }
}

if (!existsSync(DATA_DIR)) {
  console.log('No data/ directory — nothing to validate.')
  process.exit(0)
}

const files = walk(DATA_DIR)
files.forEach(validateFile)

if (errors.length) {
  console.error(`✖ ${errors.length} validation error(s):`)
  for (const e of errors) console.error('  - ' + e)
  process.exit(1)
}
console.log(`✓ validated ${files.length} file(s), no errors`)
