// 推荐牛人配置映射：两个 JSON ↔ 统一 UI state ↔ save-boss-recruiter-config 扁平 payload。
// 纯函数，零依赖，供 node:test 与 Vue/TS 复用。键名严格对齐 index.mjs(orchestrator)与 IPC handler。

export const DEFAULTS = {
  waveSize: 6,
  maxGreetPerRun: 10,
  maxViewPerRun: 20,
  maxXPerRun: 10,
  maxScrollSteps: 6,
  maxStaleWaves: 2,
  scoreConcurrency: 4,
  scoreMaxAttempts: 3,
  scrollDelayMsRange: [800, 2000],
  delayBetweenActionsMs: [1500, 4000],
  rerunIntervalMs: 600000
}

const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d)
const sortedRange = (v, d) => {
  const a = Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : [...d]
  return a[0] <= a[1] ? a : [a[1], a[0]]
}

export function normalizeRecommendConfig(raw) {
  const r = raw?.['boss-recruiter.json'] || {}
  const rp = r.recommendPage || {}
  return {
    budget: {
      waveSize: num(rp.waveSize, DEFAULTS.waveSize),
      maxGreetPerRun: num(rp.maxGreetPerRun, DEFAULTS.maxGreetPerRun),
      maxViewPerRun: num(rp.maxViewPerRun, DEFAULTS.maxViewPerRun),
      maxXPerRun: num(rp.maxXPerRun, DEFAULTS.maxXPerRun),
      maxScrollSteps: num(rp.maxScrollSteps, DEFAULTS.maxScrollSteps),
      maxStaleWaves: num(rp.maxStaleWaves, DEFAULTS.maxStaleWaves),
      scoreConcurrency: num(rp.scoreConcurrency, DEFAULTS.scoreConcurrency),
      scoreMaxAttempts: num(rp.scoreMaxAttempts, DEFAULTS.scoreMaxAttempts),
      scrollDelayMsRange: sortedRange(rp.scrollDelayMsRange, DEFAULTS.scrollDelayMsRange),
      delayBetweenActionsMs: sortedRange(rp.delayBetweenActionsMs, DEFAULTS.delayBetweenActionsMs)
    },
    run: {
      clickNotInterestedForFiltered: rp.clickNotInterestedForFiltered !== false,
      runOnceAfterComplete: rp.runOnceAfterComplete === true,
      rerunIntervalMs: num(rp.rerunIntervalMs, DEFAULTS.rerunIntervalMs),
      keepBrowserOpenAfterRun: rp.keepBrowserOpenAfterRun === true
    }
  }
}

export function toSavePayload(s) {
  // 推荐牛人页只负责运行预算/节奏。候选人筛选与评分(rubric)均按职位在「职位配置」里设置,
  // 不再从本页写入全局 candidate-filter.json / scoring。IPC 按 key 合并,省略即保留原值。
  return {
    // boss-recruiter.json
    recommendPage: {
      waveSize: s.budget.waveSize,
      maxGreetPerRun: s.budget.maxGreetPerRun,
      maxViewPerRun: s.budget.maxViewPerRun,
      maxXPerRun: s.budget.maxXPerRun,
      maxScrollSteps: s.budget.maxScrollSteps,
      maxStaleWaves: s.budget.maxStaleWaves,
      scoreConcurrency: s.budget.scoreConcurrency,
      scoreMaxAttempts: s.budget.scoreMaxAttempts,
      scrollDelayMsRange: s.budget.scrollDelayMsRange,
      delayBetweenActionsMs: s.budget.delayBetweenActionsMs,
      clickNotInterestedForFiltered: s.run.clickNotInterestedForFiltered,
      runOnceAfterComplete: s.run.runOnceAfterComplete,
      rerunIntervalMs: s.run.rerunIntervalMs,
      keepBrowserOpenAfterRun: s.run.keepBrowserOpenAfterRun
    }
  }
}
