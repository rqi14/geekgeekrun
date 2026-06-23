import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRejectReason } from './reject-reason-classifier.mjs'

const OPTS = [
  '不考虑异地牛人',
  '不考虑硕士',
  '期望薪资偏高',
  '期望（生物医药）与职位不符',
  '年龄不合适',
  '工作经历和制剂研发无关',
  '活跃度低',
  '重复推荐',
  '其他原因'
]

test('education exact match wins (硕士 → 不考虑硕士)', () => {
  const r = classifyRejectReason({ education: '硕士' }, OPTS)
  assert.equal(r.reason, '不考虑硕士')
  assert.equal(r.basis, 'education')
})

test('viewed candidate → 重复推荐', () => {
  const r = classifyRejectReason({ education: '本科', _hasViewed: true }, OPTS)
  assert.equal(r.reason, '重复推荐')
  assert.equal(r.basis, 'viewed')
})

test('never picks 其他原因 when concrete options exist', () => {
  const r = classifyRejectReason({}, OPTS)
  assert.ok(!/其他/.test(r.reason))
})

test('no strong signal → falls to 与职位不符 (mismatch)', () => {
  const r = classifyRejectReason({ education: '博士', age: '28', workExp: '3年' }, OPTS)
  assert.equal(r.reason, '期望（生物医药）与职位不符')
  assert.equal(r.basis, 'mismatch')
})

test('age extreme → 年龄不合适 when present', () => {
  const r = classifyRejectReason({ education: '博士', age: '38岁', workExp: '5年' }, OPTS)
  assert.equal(r.reason, '年龄不合适')
})

test('only 其他原因 available → returns it as last resort', () => {
  const r = classifyRejectReason({}, ['其他原因'])
  assert.equal(r.reason, '其他原因')
})

test('empty options → null', () => {
  const r = classifyRejectReason({ education: '硕士' }, [])
  assert.equal(r.reason, null)
  assert.equal(r.index, -1)
})
