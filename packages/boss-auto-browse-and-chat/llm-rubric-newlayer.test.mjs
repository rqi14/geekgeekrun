import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateResumeByRubric, __setChatCompleteForPurpose } from './llm-rubric.mjs'

test('evaluateResumeByRubric uses new layer parsed result', async () => {
  let captured
  __setChatCompleteForPurpose(async (config, purpose, messages, opts) => {
    captured = { purpose, opts }
    return { parsed: { knockout_failed: false, dimension_scores: { 能力: 5 }, reasoning: 'good' }, usage: {} }
  })
  const rubric = { dimensions: [{ name: '能力', weight: 100, criteria: { 5: 'x' } }], passThreshold: 50 }
  const r = await evaluateResumeByRubric('resume', rubric, {})
  assert.equal(captured.purpose, 'resume_screening')
  assert.equal(captured.opts.maxOutputTokens, 500)
  assert.equal(r.isPassed, true)
  assert.equal(r.totalScore, 100)
  __setChatCompleteForPurpose(null) // reset
})

test('evaluateResumeByRubric: layer throws → default pass', async () => {
  __setChatCompleteForPurpose(async () => { throw new Error('all models failed') })
  const r = await evaluateResumeByRubric('resume', { dimensions: [{ name: 'a', weight: 100, criteria: {} }] }, {})
  assert.equal(r.isPassed, true) // 兜底默认通过
  __setChatCompleteForPurpose(null)
})
