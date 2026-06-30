/**
 * 卡片层"专业/方向对口吗"纯规则判定。include/例外词 压过 exclude。
 * @param {{majors?:string[], advantage?:string, expectDirection?:string, extraText?:string}} card
 * @param {{include?:string[], exclude?:string[]}} cfg
 * @returns {{result:'keep'|'knockout'|'gray', via:('include'|'exclude'|null), hit:(string|null)}}
 *   keep: 命中 include（对口/例外）; knockout: 命中 exclude 且未命中 include; gray: 都没命中
 *   未配置 include 且未配置 exclude → 一律 gray（无意见，安全默认）
 */
export function fieldKnockout(card, cfg) {
  if (!card) return { result: 'gray', via: null, hit: null }

  const include = (cfg.include || []).map(k => k.trim()).filter(Boolean)
  const exclude = (cfg.exclude || []).map(k => k.trim()).filter(Boolean)

  if (include.length === 0 && exclude.length === 0) {
    return { result: 'gray', via: null, hit: null }
  }

  const majorsText = Array.isArray(card.majors) ? card.majors.join(' ') : (card.majors || '')
  const parts = [
    majorsText,
    card.advantage || '',
    card.expectDirection || '',
    card.extraText || ''
  ]
  const haystack = parts.join(' ')
  const haystackLower = haystack.toLowerCase()

  // collect all exclude-matched ranges
  const excludeRanges = []
  let excludeHit = null
  for (const kw of exclude) {
    const kwLower = kw.toLowerCase()
    let idx = 0
    let found = false
    while (true) {
      const pos = haystackLower.indexOf(kwLower, idx)
      if (pos === -1) break
      excludeRanges.push([pos, pos + kwLower.length])
      if (!found) {
        if (excludeHit === null) excludeHit = kw
        found = true
      }
      idx = pos + 1
    }
  }

  // include overrides only when the match is NOT fully inside an exclude range
  for (const kw of include) {
    const kwLower = kw.toLowerCase()
    let idx = 0
    while (true) {
      const pos = haystackLower.indexOf(kwLower, idx)
      if (pos === -1) break
      const end = pos + kwLower.length
      const insideExclude = excludeRanges.some(([s, e]) => pos >= s && end <= e)
      if (!insideExclude) {
        return { result: 'keep', via: 'include', hit: kw }
      }
      idx = pos + 1
    }
  }

  if (excludeHit !== null) {
    return { result: 'knockout', via: 'exclude', hit: excludeHit }
  }

  return { result: 'gray', via: null, hit: null }
}
