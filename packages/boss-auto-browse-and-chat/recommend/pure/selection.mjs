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

/** 活跃度排序权重：越活跃越大（同分打招呼时优先更可能回复的人） */
export function activityRank (activeText) {
  const t = String(activeText ?? '')
  if (t.includes('刚刚')) return 5
  if (t.includes('今日') || t.includes('今天')) return 4
  if (t.includes('本周') || /\d+\s*日内/.test(t)) return 3
  if (t.includes('活跃')) return 2
  return 0
}

/**
 * 从已打分集合选"打招呼集"：去 hardReject、过阈值、按分降序、同分按活跃度降序、截 greetBudget。
 * @param {Array<{candidate:object,score:number,hardReject?:boolean}>} scored
 * @param {{minScore?:number, greetBudget?:number}} opts
 */
export function selectForGreet (scored, { minScore = 0, greetBudget = 0 } = {}) {
  if (!Array.isArray(scored) || greetBudget <= 0) return []
  return scored
    .filter((s) => s && !s.hardReject && typeof s.score === 'number' && s.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (activityRank(b.candidate?.activeText) - activityRank(a.candidate?.activeText)))
    .slice(0, greetBudget)
}

export const RECOMMEND_JOB_DROPDOWN_SELECTORS = [
  '#headerWrap .ui-dropmenu-label',
  '.dropmenu-label.chat-select-job',
  '.chat-top-job .ui-dropmenu-label',
  '.chat-top-job .dropmenu-label',
  '.ui-dropmenu-label.chat-select-job'
]

export const RECOMMEND_JOB_ITEM_SELECTORS = [
  '#headerWrap ul.job-list li.job-item',
  '.chat-top-job .ui-dropmenu-list li',
  'ul.job-list li.job-item',
  '.ui-dropmenu-list li[value]'
]

export function getJobItemValue (attrs = {}) {
  return String(attrs.value || attrs.dataJobId || attrs.dataId || '').trim()
}

export function joinSelectors (selectors) {
  return selectors.join(', ')
}

/**
 * Canvas identity match is strongest. In rule-only mode, a confirmed modal
 * identity plus non-empty summary is allowed as fallback so a missing Canvas
 * hook does not make every candidate ungreetable.
 */
export function evaluateResumeEvidence (input = {}) {
  if (input.canvasOk === true) {
    return { verified: true, source: 'canvas', reason: '' }
  }

  const summary = String(input.summary ?? '').trim()
  const canUseSummaryFallback =
    input.requireCanvasVerified !== true &&
    input.scoringMode === 'rule-only' &&
    input.identityOk !== false &&
    summary.length > 0

  if (canUseSummaryFallback) {
    return { verified: true, source: 'summaryFallback', reason: 'canvasEmptySummaryFallback' }
  }

  return { verified: false, source: 'none', reason: 'canvasNotVerified' }
}

export function classifyGreetConfirmation ({ quotaBlocked = false, knowDialogHandled = false } = {}) {
  if (quotaBlocked) return 'quota-blocked'
  return knowDialogHandled ? 'confirmed' : 'not-confirmed'
}
