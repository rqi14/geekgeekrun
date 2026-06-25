import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleGate, mergeScore } from './scorer-gate.mjs'

test('ruleGate hardReject when resume rule fails', () => {
  const r = ruleGate({ education: '本科' }, { expectEducationList: ['硕士'] })
  assert.equal(r.result, 'hardReject')
  assert.equal(r.reason, 'education')
})
test('ruleGate pass when rules ok', () => {
  const r = ruleGate({ education: '硕士' }, { expectEducationList: ['硕士'] })
  assert.equal(r.result, 'pass')
})
test('mergeScore: gate hardReject overrides llm', () => {
  const m = mergeScore({ result: 'hardReject', reason: 'education' }, { score: 90 }, { minScoreToChat: 60 })
  assert.equal(m.hardReject, true)
})
test('mergeScore: llm null + onScoreError skip → below threshold, not hardReject', () => {
  const m = mergeScore({ result: 'pass' }, null, { minScoreToChat: 60, onScoreError: 'skip' })
  assert.equal(m.hardReject, false)
  assert.ok(m.score < 60)
})
test('mergeScore: llm null + greetIfRulePass → score at threshold', () => {
  const m = mergeScore({ result: 'pass' }, null, { minScoreToChat: 60, onScoreError: 'greetIfRulePass' })
  assert.ok(m.score >= 60)
})
test('mergeScore: normal llm score passes through', () => {
  const m = mergeScore({ result: 'pass' }, { score: 75, reason: 'good' }, { minScoreToChat: 60 })
  assert.equal(m.score, 75)
  assert.equal(m.hardReject, false)
})
test('mergeScore: skip stays below threshold even when minScoreToChat is 0', () => {
  const m = mergeScore({ result: 'pass' }, null, { minScoreToChat: 0, onScoreError: 'skip' })
  assert.ok(m.score < 0)
  assert.equal(m.hardReject, false)
})
