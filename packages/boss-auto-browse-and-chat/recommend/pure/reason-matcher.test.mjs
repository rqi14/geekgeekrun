import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyReason } from './reason-matcher.mjs'

const FALLBACK = '其他原因'
// 真实选项（来自 dev/snapshots/005-reason-popup 与 001-resume-reject，文案随候选人/JD 变化）
const OPTIONS = ['牛人距离远', '不考虑硕士', '期望薪资偏高', '期望（药物分析）与职位不符', '年龄不合适', '工作经历和制剂研发无关', '活跃度低', '重复推荐', '其他原因']

test('city → 距离远', () => {
  assert.equal(fuzzyReason('city', OPTIONS, FALLBACK), '牛人距离远')
})
test('education matches 不考虑硕士 even though hardcoded enum said 本科', () => {
  assert.equal(fuzzyReason('education', OPTIONS, FALLBACK), '不考虑硕士')
})
test('workExp → 与职位不符 preferred over 工作经历', () => {
  assert.equal(fuzzyReason('workExp', OPTIONS, FALLBACK), '期望（药物分析）与职位不符')
})
test('viewed → 重复推荐', () => {
  assert.equal(fuzzyReason('viewed', OPTIONS, FALLBACK), '重复推荐')
})
test('unknown reason → fallback', () => {
  assert.equal(fuzzyReason('zzz', OPTIONS, FALLBACK), '其他原因')
})
test('no option matches → fallback', () => {
  assert.equal(fuzzyReason('city', ['仅这一个'], FALLBACK), '仅这一个'.includes('距离远') ? '仅这一个' : FALLBACK)
})
