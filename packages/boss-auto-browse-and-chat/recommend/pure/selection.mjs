/**
 * 按预排序分数 best-first 排序，截取前 viewBudget 个作为"开简历集"。
 * @param {Array<object>} pool
 * @param {(c:object)=>number} prescore
 * @param {number} viewBudget
 */
export function rankForOpen (pool, prescore, viewBudget) {
  if (!Array.isArray(pool) || viewBudget <= 0) return []
  return [...pool].sort((a, b) => prescore(b) - prescore(a)).slice(0, viewBudget)
}

/**
 * 从已打分集合选"打招呼集"：去 hardReject、过阈值、按分降序、截 greetBudget。
 * @param {Array<{candidate:object,score:number,hardReject?:boolean}>} scored
 * @param {{minScore?:number, greetBudget?:number}} opts
 */
export function selectForGreet (scored, { minScore = 0, greetBudget = 0 } = {}) {
  if (!Array.isArray(scored) || greetBudget <= 0) return []
  return scored
    .filter((s) => s && !s.hardReject && typeof s.score === 'number' && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, greetBudget)
}
