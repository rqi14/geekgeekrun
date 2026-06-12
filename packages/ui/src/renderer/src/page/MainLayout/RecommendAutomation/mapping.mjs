// 推荐牛人配置映射：两个 JSON ↔ 统一 UI state ↔ save-boss-recruiter-config 扁平 payload。
// 纯函数，零依赖，供 node:test 与 Vue/TS 复用。键名严格对齐 index.mjs(orchestrator)与 IPC handler。

export const DEFAULTS = {
  waveSize: 6,
  maxGreetPerRun: 10,
  maxXPerRun: 10,
  maxScrollSteps: 6,
  maxStaleWaves: 2,
  scrollDelayMsRange: [800, 2000],
  delayBetweenActionsMs: [1500, 4000],
  minScoreToChat: 0,
  onScoreError: 'skip',
  rerunIntervalMs: 600000
}

const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d)
const sortedRange = (v, d) => {
  const a = Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : [...d]
  return a[0] <= a[1] ? a : [a[1], a[0]]
}

export function normalizeRecommendConfig(raw) {
  const r = raw?.['boss-recruiter.json'] || {}
  const f = raw?.['candidate-filter.json'] || {}
  const rp = r.recommendPage || {}
  const sc = r.scoring || {}
  return {
    scoring: {
      enabled: sc.enabled === true,
      jd: typeof sc.jd === 'string' ? sc.jd : '',
      minScoreToChat: num(sc.minScoreToChat, DEFAULTS.minScoreToChat),
      onScoreError: sc.onScoreError === 'greetIfRulePass' ? 'greetIfRulePass' : 'skip',
      modelId: sc.modelId ?? null
    },
    filter: {
      expectCityList: arr(f.expectCityList),
      expectEducationRegExpStr:
        typeof f.expectEducationRegExpStr === 'string' ? f.expectEducationRegExpStr : '',
      expectWorkExpRange: sortedRange(f.expectWorkExpRange, [0, 99]),
      expectSalaryRange: sortedRange(f.expectSalaryRange, [0, 0]),
      expectSalaryWhenNegotiable:
        f.expectSalaryWhenNegotiable === 'include' ? 'include' : 'exclude',
      expectSkillKeywords: arr(f.expectSkillKeywords),
      expectSchoolKeywords: arr(f.expectSchoolKeywords),
      expectMajorKeywords: arr(f.expectMajorKeywords),
      blockCandidateNameRegExpStr:
        typeof f.blockCandidateNameRegExpStr === 'string' ? f.blockCandidateNameRegExpStr : '',
      skipViewedCandidates: (rp.skipViewedCandidates ?? f.skipViewedCandidates) === true
    },
    budget: {
      waveSize: num(rp.waveSize, DEFAULTS.waveSize),
      maxGreetPerRun: num(rp.maxGreetPerRun, DEFAULTS.maxGreetPerRun),
      maxXPerRun: num(rp.maxXPerRun, DEFAULTS.maxXPerRun),
      maxScrollSteps: num(rp.maxScrollSteps, DEFAULTS.maxScrollSteps),
      maxStaleWaves: num(rp.maxStaleWaves, DEFAULTS.maxStaleWaves),
      scrollDelayMsRange: sortedRange(rp.scrollDelayMsRange, DEFAULTS.scrollDelayMsRange),
      delayBetweenActionsMs: sortedRange(rp.delayBetweenActionsMs, DEFAULTS.delayBetweenActionsMs)
    },
    run: {
      clickNotInterestedForFiltered: rp.clickNotInterestedForFiltered !== false,
      runOnceAfterComplete: rp.runOnceAfterComplete === true,
      rerunIntervalMs: num(rp.rerunIntervalMs, DEFAULTS.rerunIntervalMs),
      keepBrowserOpenAfterRun: rp.keepBrowserOpenAfterRun === true,
      persistProfile: r.advanced?.persistProfile === true
    }
  }
}

export function toSavePayload(s) {
  return {
    // candidate-filter.json（save-boss-recruiter-config 读扁平键）
    expectCityList: s.filter.expectCityList,
    expectEducationRegExpStr: s.filter.expectEducationRegExpStr,
    expectWorkExpRange: s.filter.expectWorkExpRange,
    expectSalaryRange: s.filter.expectSalaryRange,
    expectSalaryWhenNegotiable: s.filter.expectSalaryWhenNegotiable,
    expectSkillKeywords: s.filter.expectSkillKeywords,
    expectSchoolKeywords: s.filter.expectSchoolKeywords,
    expectMajorKeywords: s.filter.expectMajorKeywords,
    blockCandidateNameRegExpStr: s.filter.blockCandidateNameRegExpStr,
    skipViewedCandidates: s.filter.skipViewedCandidates,
    // boss-recruiter.json
    scoring: { ...s.scoring },
    advanced: { persistProfile: s.run.persistProfile },
    recommendPage: {
      waveSize: s.budget.waveSize,
      maxGreetPerRun: s.budget.maxGreetPerRun,
      maxXPerRun: s.budget.maxXPerRun,
      maxScrollSteps: s.budget.maxScrollSteps,
      maxStaleWaves: s.budget.maxStaleWaves,
      scrollDelayMsRange: s.budget.scrollDelayMsRange,
      delayBetweenActionsMs: s.budget.delayBetweenActionsMs,
      clickNotInterestedForFiltered: s.run.clickNotInterestedForFiltered,
      runOnceAfterComplete: s.run.runOnceAfterComplete,
      rerunIntervalMs: s.run.rerunIntervalMs,
      keepBrowserOpenAfterRun: s.run.keepBrowserOpenAfterRun,
      skipViewedCandidates: s.filter.skipViewedCandidates
    }
  }
}
