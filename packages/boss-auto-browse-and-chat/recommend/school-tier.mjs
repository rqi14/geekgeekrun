import { readFileSync } from 'node:fs'

const DATA = JSON.parse(readFileSync(new URL('./data/cn-school-tier.json', import.meta.url), 'utf8'))

// Build lookup maps once at module load
const nameMap = new Map()
const aliasMap = new Map()

for (const record of DATA) {
  nameMap.set(record.name, record)
  if (Array.isArray(record.aliases)) {
    for (const alias of record.aliases) {
      aliasMap.set(alias.toLowerCase(), record)
    }
  }
}

// Sorted known names by length descending for prefix matching
const sortedNames = [...nameMap.keys()].sort((a, b) => b.length - a.length)

/**
 * Normalize school name: trim and strip trailing parenthetical/bracket suffixes.
 * Strips: 全角（…）, 半角(...), 【…】, ［…］
 */
function normalize(name) {
  if (!name) return ''
  return name
    .trim()
    .replace(/[（(【［][^）)】］]*[）)】］].*$/, '')
    .trim()
}

/**
 * Derive tier/rank from a matched record.
 */
function deriveTier(record) {
  if (record.p985) return { tier: '985', rank: 5 }
  if (record.p211) return { tier: '211', rank: 4 }
  if (record.syl) return { tier: '双一流', rank: 3 }
  if (record.level === '本科') return { tier: '本科', rank: 2 }
  if (record.level === '专科') return { tier: '专科', rank: 1 }
  return { tier: 'unknown', rank: 0 }
}

const UNKNOWN_RESULT = {
  matched: false,
  matchedName: null,
  tier: 'unknown',
  rank: 0,
  p985: false,
  p211: false,
  syl: false,
  level: null,
}

/**
 * 查学校层级。返回 { matched, matchedName, tier, rank, p985, p211, syl, level }。
 * tier: '985' | '211' | '双一流' | '本科' | '专科' | 'unknown'
 * rank: 985=5, 211=4, 双一流=3, 本科=2, 专科=1, unknown=0（用于排序）
 * 海外/查不到 → tier 'unknown', rank 0, matched false。
 */
export function schoolTier(schoolName) {
  if (!schoolName) return { ...UNKNOWN_RESULT }

  // Step 1: normalize
  const norm = normalize(schoolName)
  if (!norm) return { ...UNKNOWN_RESULT }

  // Step 2: exact match on normalized name
  if (nameMap.has(norm)) {
    const record = nameMap.get(norm)
    const { tier, rank } = deriveTier(record)
    return {
      matched: true,
      matchedName: record.name,
      tier,
      rank,
      p985: record.p985,
      p211: record.p211,
      syl: record.syl,
      level: record.level,
    }
  }

  // Step 3: alias match (case-insensitive)
  const normLower = norm.toLowerCase()
  if (aliasMap.has(normLower)) {
    const record = aliasMap.get(normLower)
    const { tier, rank } = deriveTier(record)
    return {
      matched: true,
      matchedName: record.name,
      tier,
      rank,
      p985: record.p985,
      p211: record.p211,
      syl: record.syl,
      level: record.level,
    }
  }

  // Step 4: prefix fallback — find the longest known name that is a prefix of norm
  // Only accept if known name length >= 4
  let bestRecord = null
  let bestLen = 0
  for (const knownName of sortedNames) {
    if (knownName.length < 4) continue
    if (knownName.length <= bestLen) break // sorted descending, no point checking shorter
    if (norm.startsWith(knownName)) {
      bestRecord = nameMap.get(knownName)
      bestLen = knownName.length
      break // sorted descending, first match is the longest
    }
  }

  if (bestRecord) {
    const { tier, rank } = deriveTier(bestRecord)
    return {
      matched: true,
      matchedName: bestRecord.name,
      tier,
      rank,
      p985: bestRecord.p985,
      p211: bestRecord.p211,
      syl: bestRecord.syl,
      level: bestRecord.level,
    }
  }

  // Step 5: unknown
  return { ...UNKNOWN_RESULT }
}
