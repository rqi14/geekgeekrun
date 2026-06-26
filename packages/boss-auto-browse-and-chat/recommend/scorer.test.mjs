import { test } from 'node:test'
import assert from 'node:assert/strict'
import { score, buildResumeText } from './scorer.mjs'

const cfg = { rules: { expectEducationList: ['硕士'] }, minScoreToChat: 60, onScoreError: 'skip', llm: {} }

test('hardReject short-circuits without calling LLM', async () => {
  let called = false
  const fakeLlm = async () => { called = true; return { score: 99 } }
  const r = await score({ education: '本科' }, { summary: '' }, cfg, fakeLlm)
  assert.equal(r.hardReject, true)
  assert.equal(called, false)
})
test('passes through LLM score on rule pass', async () => {
  const fakeLlm = async () => ({ score: 72, reason: 'ok' })
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.score, 72)
  assert.equal(r.hardReject, false)
})
test('LLM throw → merged via onScoreError skip (below threshold)', async () => {
  const fakeLlm = async () => { throw new Error('rate limit') }
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.hardReject, false)
  assert.ok(r.score < 60)
})
test('LLM returns null → treated as error path', async () => {
  const fakeLlm = async () => null
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.ok(r.score < 60)
})
test('llmError 透传：LLM 抛错 → result.llmError=true（供重试队列判定）', async () => {
  const fakeLlm = async () => { throw new Error('429 rate limit') }
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.llmError, true)
})
test('llmError 透传：LLM 返回 llmError 标记 → result.llmError=true', async () => {
  const fakeLlm = async () => ({ score: 0, reason: '兜底', llmError: true })
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.llmError, true)
})
test('llmError 透传：正常评分不带 llmError', async () => {
  const fakeLlm = async () => ({ score: 80, reason: 'ok' })
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.notEqual(r.llmError, true)
})
test('llmError 透传：LLM 返回 null（无 rubric）不算 llmError（不重试）', async () => {
  const fakeLlm = async () => null
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.notEqual(r.llmError, true)
})
test('buildResumeText includes degree and summary', () => {
  const t = buildResumeText({ geekName: '甲', education: '硕士', tags: ['QS前500'] }, { summary: '浙大 硕士' })
  assert.match(t, /硕士/)
  assert.match(t, /经历概览/)
  assert.match(t, /QS前500/)
})
