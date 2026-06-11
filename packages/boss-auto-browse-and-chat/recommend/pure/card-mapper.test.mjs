import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRawCard, isPrimaryCard } from './card-mapper.mjs'

const raw = {
  encryptGeekId: '32a7d58d87424e000HF83tm9EFpZ',
  name: '朱睿婕', salary: '10-11K', activeText: '刚刚活跃',
  baseInfo: ['25岁', '26年应届生', '硕士'],
  expect: ['杭州', '化工'], advantage: '具备扎实科研能力', tags: ['QS前500院校'],
  isSimilar: false, inViewport: true, interactable: true
}

test('maps base-info into education/workExp/age', () => {
  const c = mapRawCard(raw)
  assert.equal(c.encryptGeekId, raw.encryptGeekId)
  assert.equal(c.education, '硕士')
  assert.equal(c.city, '杭州')
  assert.equal(c.salary, '10-11K')
})
test('isPrimaryCard false when isSimilar', () => {
  assert.equal(isPrimaryCard({ ...raw, isSimilar: true }), false)
})
test('isPrimaryCard false when no encryptGeekId', () => {
  assert.equal(isPrimaryCard({ ...raw, encryptGeekId: '' }), false)
})
test('isPrimaryCard true for a normal card', () => {
  assert.equal(isPrimaryCard(raw), true)
})
