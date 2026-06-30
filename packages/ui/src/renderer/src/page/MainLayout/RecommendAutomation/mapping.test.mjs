import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecommendConfig, toSavePayload, DEFAULTS } from './mapping.mjs'

test('fills defaults when configs empty', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  assert.equal(s.budget.maxGreetPerRun, DEFAULTS.maxGreetPerRun)
  assert.equal(s.budget.maxScrollSteps, DEFAULTS.maxScrollSteps)
  assert.equal(s.scoring.enabled, false)
  assert.equal(s.scoring.onScoreError, 'skip')
  assert.deepEqual(s.filter.expectSchoolKeywords, [])
})
test('reads existing values', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': {
      recommendPage: { maxGreetPerRun: 3, maxXPerRun: 5 },
      scoring: { enabled: true, jd: 'x', minScoreToChat: 70 }
    },
    'candidate-filter.json': { expectSchoolKeywords: ['双一流'], expectSalaryRange: [10, 20] }
  })
  assert.equal(s.budget.maxGreetPerRun, 3)
  assert.equal(s.budget.maxXPerRun, 5)
  assert.equal(s.scoring.enabled, true)
  assert.equal(s.scoring.minScoreToChat, 70)
  assert.deepEqual(s.filter.expectSchoolKeywords, ['双一流'])
})
test('toSavePayload round-trips key names the IPC + orchestrator expect', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  s.filter.expectSchoolKeywords = ['QS']
  s.filter.expectMajorKeywords = ['食品']
  s.scoring.enabled = true
  s.scoring.jd = 'JD here'
  s.budget.maxGreetPerRun = 2
  const p = toSavePayload(s)
  assert.deepEqual(p.expectSchoolKeywords, ['QS'])
  assert.deepEqual(p.expectMajorKeywords, ['食品'])
  assert.equal(p.scoring.enabled, true)
  assert.equal(p.scoring.jd, 'JD here')
  assert.equal(p.recommendPage.maxGreetPerRun, 2)
})
test('scoreConcurrency/scoreMaxAttempts/maxViewPerRun: defaults + round-trip', () => {
  const empty = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  assert.equal(empty.budget.scoreConcurrency, DEFAULTS.scoreConcurrency)
  assert.equal(empty.budget.scoreMaxAttempts, DEFAULTS.scoreMaxAttempts)
  assert.equal(empty.budget.maxViewPerRun, DEFAULTS.maxViewPerRun)

  const s = normalizeRecommendConfig({
    'boss-recruiter.json': {
      recommendPage: { scoreConcurrency: 2, scoreMaxAttempts: 5, maxViewPerRun: 8 }
    },
    'candidate-filter.json': {}
  })
  assert.equal(s.budget.scoreConcurrency, 2)
  assert.equal(s.budget.scoreMaxAttempts, 5)
  assert.equal(s.budget.maxViewPerRun, 8)

  const p = toSavePayload(s)
  assert.equal(p.recommendPage.scoreConcurrency, 2)
  assert.equal(p.recommendPage.scoreMaxAttempts, 5)
  assert.equal(p.recommendPage.maxViewPerRun, 8)
})
test('clamps ranges (min<=max)', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': {},
    'candidate-filter.json': { expectSalaryRange: [30, 10] }
  })
  assert.ok(s.filter.expectSalaryRange[0] <= s.filter.expectSalaryRange[1])
})
test('skipViewed prefers recommendPage over candidate-filter', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': { recommendPage: { skipViewedCandidates: true } },
    'candidate-filter.json': { skipViewedCandidates: false }
  })
  assert.equal(s.filter.skipViewedCandidates, true)
})
test('clickNotInterestedForFiltered defaults true, false respected', () => {
  const on = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  assert.equal(on.run.clickNotInterestedForFiltered, true)
  const off = normalizeRecommendConfig({
    'boss-recruiter.json': { recommendPage: { clickNotInterestedForFiltered: false } },
    'candidate-filter.json': {}
  })
  assert.equal(off.run.clickNotInterestedForFiltered, false)
  assert.equal(toSavePayload(off).recommendPage.clickNotInterestedForFiltered, false)
})
