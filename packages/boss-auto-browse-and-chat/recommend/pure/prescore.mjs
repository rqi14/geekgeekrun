const DEGREE_RANK = { 博士: 5, 硕士: 4, 本科: 3, 大专: 2, 专科: 2, 高中: 1 }
const GOOD_TAG_RE = /QS|985|211|双一流|海归|留学/

/**
 * 仅用列表文字给个便宜的预估分，用于"先处理更可能优的"排序。不调用任何 IO。
 * 不是最终评分（最终分见 scorer.mjs）。
 * @param {{education?:string, tags?:string[], activeText?:string}} card
 * @returns {number}
 */
export function cheapPrescore (card) {
  let s = 0
  const deg = card?.education ?? ''
  for (const k of Object.keys(DEGREE_RANK)) if (deg.includes(k)) { s += DEGREE_RANK[k] * 10; break }
  const tags = Array.isArray(card?.tags) ? card.tags : []
  if (tags.some((t) => GOOD_TAG_RE.test(t))) s += 15
  if (/刚刚活跃|今日活跃|活跃/.test(card?.activeText ?? '')) s += 5
  return s
}
