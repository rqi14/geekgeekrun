import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecommendConfig, toSavePayload, DEFAULTS } from './mapping.mjs'

// 推荐牛人页只负责运行预算/节奏；筛选与评分按职位在「职位配置」里设置,本页不读写它们。

test('fills budget/run defaults when config empty', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {} })
  assert.equal(s.budget.maxGreetPerRun, DEFAULTS.maxGreetPerRun)
  assert.equal(s.budget.maxScrollSteps, DEFAULTS.maxScrollSteps)
  assert.equal(s.run.clickNotInterestedForFiltered, true)
})
test('reads existing budget values', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': {
      recommendPage: { maxGreetPerRun: 3, maxXPerRun: 5 }
    }
  })
  assert.equal(s.budget.maxGreetPerRun, 3)
  assert.equal(s.budget.maxXPerRun, 5)
})
test('toSavePayload writes only recommendPage (no filter/scoring/advanced keys)', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {} })
  s.budget.maxGreetPerRun = 2
  const p = toSavePayload(s)
  assert.equal(p.recommendPage.maxGreetPerRun, 2)
  // 不得携带全局筛选/评分键,以免覆盖按职位配置的回退值;
  // persistProfile 改由「全局运行设置」页统一管理,本页不再写 advanced
  assert.equal('scoring' in p, false)
  assert.equal('expectSchoolKeywords' in p, false)
  assert.equal('skipViewedCandidates' in p, false)
  assert.equal('advanced' in p, false)
})
test('scoreConcurrency/scoreMaxAttempts/maxViewPerRun: defaults + round-trip', () => {
  const empty = normalizeRecommendConfig({ 'boss-recruiter.json': {} })
  assert.equal(empty.budget.scoreConcurrency, DEFAULTS.scoreConcurrency)
  assert.equal(empty.budget.scoreMaxAttempts, DEFAULTS.scoreMaxAttempts)
  assert.equal(empty.budget.maxViewPerRun, DEFAULTS.maxViewPerRun)

  const s = normalizeRecommendConfig({
    'boss-recruiter.json': {
      recommendPage: { scoreConcurrency: 2, scoreMaxAttempts: 5, maxViewPerRun: 8 }
    }
  })
  assert.equal(s.budget.scoreConcurrency, 2)
  assert.equal(s.budget.scoreMaxAttempts, 5)
  assert.equal(s.budget.maxViewPerRun, 8)

  const p = toSavePayload(s)
  assert.equal(p.recommendPage.scoreConcurrency, 2)
  assert.equal(p.recommendPage.scoreMaxAttempts, 5)
  assert.equal(p.recommendPage.maxViewPerRun, 8)
})
test('clamps budget ranges (min<=max)', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': { recommendPage: { scrollDelayMsRange: [2000, 800] } }
  })
  assert.ok(s.budget.scrollDelayMsRange[0] <= s.budget.scrollDelayMsRange[1])
})
test('clickNotInterestedForFiltered defaults true, false respected', () => {
  const on = normalizeRecommendConfig({ 'boss-recruiter.json': {} })
  assert.equal(on.run.clickNotInterestedForFiltered, true)
  const off = normalizeRecommendConfig({
    'boss-recruiter.json': { recommendPage: { clickNotInterestedForFiltered: false } }
  })
  assert.equal(off.run.clickNotInterestedForFiltered, false)
  assert.equal(toSavePayload(off).recommendPage.clickNotInterestedForFiltered, false)
})
