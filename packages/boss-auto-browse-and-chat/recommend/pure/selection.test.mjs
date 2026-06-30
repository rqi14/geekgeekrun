import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  rankForOpen,
  selectForGreet,
  RECOMMEND_JOB_DROPDOWN_SELECTORS,
  RECOMMEND_JOB_ITEM_SELECTORS,
  getJobItemValue,
  evaluateResumeEvidence
} from './selection.mjs'

const pre = (c) => c.s

test('rankForOpen：best-first 排序并截取 viewBudget', () => {
  const pool = [{ id: 'a', s: 1 }, { id: 'b', s: 3 }, { id: 'c', s: 2 }]
  const r = rankForOpen(pool, pre, 2)
  assert.deepEqual(r.map((x) => x.id), ['b', 'c'])
})

test('rankForOpen：viewBudget<=0 → 空', () => {
  assert.deepEqual(rankForOpen([{ id: 'a', s: 1 }], pre, 0), [])
})

test('selectForGreet：去 hardReject + 过阈值 + 按分降序 + 截 greetBudget', () => {
  const scored = [
    { candidate: { id: 'a' }, score: 90, hardReject: false },
    { candidate: { id: 'b' }, score: 95, hardReject: true },
    { candidate: { id: 'c' }, score: 80, hardReject: false },
    { candidate: { id: 'd' }, score: 50, hardReject: false }
  ]
  const r = selectForGreet(scored, { minScore: 60, greetBudget: 2 })
  assert.deepEqual(r.map((x) => x.candidate.id), ['a', 'c'])
})

test('selectForGreet：greetBudget<=0 → 空', () => {
  assert.deepEqual(selectForGreet([{ candidate: {}, score: 99, hardReject: false }], { minScore: 0, greetBudget: 0 }), [])
})

test('selectForGreet：同分时优先更活跃的', () => {
  const scored = [
    { candidate: { id: 'a', activeText: '本周活跃' }, score: 80, hardReject: false },
    { candidate: { id: 'b', activeText: '刚刚活跃' }, score: 80, hardReject: false },
    { candidate: { id: 'c', activeText: '今日活跃' }, score: 80, hardReject: false }
  ]
  const r = selectForGreet(scored, { minScore: 0, greetBudget: 3 })
  assert.deepEqual(r.map((x) => x.candidate.id), ['b', 'c', 'a'])
})

test('selectForGreet：分数仍是第一排序键，活跃度只在同分时生效', () => {
  const scored = [
    { candidate: { id: 'a', activeText: '刚刚活跃' }, score: 70, hardReject: false },
    { candidate: { id: 'b', activeText: '本周活跃' }, score: 90, hardReject: false }
  ]
  const r = selectForGreet(scored, { minScore: 0, greetBudget: 2 })
  assert.deepEqual(r.map((x) => x.candidate.id), ['b', 'a'])
})

test('recommend job switch selectors support both old header and current chat-style dropdowns', () => {
  assert.ok(RECOMMEND_JOB_DROPDOWN_SELECTORS.includes('#headerWrap .ui-dropmenu-label'))
  assert.ok(RECOMMEND_JOB_DROPDOWN_SELECTORS.includes('.dropmenu-label.chat-select-job'))
  assert.ok(RECOMMEND_JOB_ITEM_SELECTORS.includes('#headerWrap ul.job-list li.job-item'))
  assert.ok(RECOMMEND_JOB_ITEM_SELECTORS.includes('.chat-top-job .ui-dropmenu-list li'))
})

test('getJobItemValue reads value first and falls back to data-job-id', () => {
  assert.equal(getJobItemValue({ value: '123', dataJobId: '456' }), '123')
  assert.equal(getJobItemValue({ value: '', dataJobId: '456' }), '456')
  assert.equal(getJobItemValue({}), '')
})

test('evaluateResumeEvidence allows rule-only summary fallback after identity confirmation', () => {
  assert.deepEqual(
    evaluateResumeEvidence({
      canvasOk: false,
      summary: '经历概览：本科 3 年 Java',
      identityOk: true,
      scoringMode: 'rule-only'
    }),
    { verified: true, source: 'summaryFallback', reason: 'canvasEmptySummaryFallback' }
  )
})

test('evaluateResumeEvidence still requires canvas for llm-rubric mode', () => {
  assert.deepEqual(
    evaluateResumeEvidence({
      canvasOk: false,
      summary: '经历概览：本科 3 年 Java',
      identityOk: true,
      scoringMode: 'llm-rubric'
    }),
    { verified: false, source: 'none', reason: 'canvasNotVerified' }
  )
})

test('evaluateResumeEvidence can require canvas explicitly', () => {
  assert.deepEqual(
    evaluateResumeEvidence({
      canvasOk: false,
      summary: '经历概览',
      identityOk: true,
      scoringMode: 'rule-only',
      requireCanvasVerified: true
    }),
    { verified: false, source: 'none', reason: 'canvasNotVerified' }
  )
})
