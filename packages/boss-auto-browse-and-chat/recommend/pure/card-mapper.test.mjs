import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRawCard, isPrimaryCard } from './card-mapper.mjs'

const raw = {
  encryptGeekId: '32a7d58d87424e000HF83tm9EFpZ',
  name: '朱睿婕', salary: '10-11K', activeText: '刚刚活跃',
  baseInfo: ['25岁', '26年应届生', '硕士'],
  expect: ['杭州', '化工'], advantage: '具备扎实科研能力', tags: ['QS前500院校'],
  eduExps: [
    { school: '浙江大学', major: '食品科学', degree: '博士' },
    { school: '浙江工商大学', major: '食品科学与工程', degree: '硕士' }
  ],
  workExps: [{ company: '浙大', title: '博士研究员' }],
  isSimilar: false, inViewport: true, interactable: true
}

test('maps base-info into education/workExp/age', () => {
  const c = mapRawCard(raw)
  assert.equal(c.encryptGeekId, raw.encryptGeekId)
  assert.equal(c.education, '硕士')
  assert.equal(c.city, '杭州')
  assert.equal(c.salary, '10-11K')
})
test('maps edu-exps into schools/majors and keeps eduExps', () => {
  const c = mapRawCard(raw)
  assert.deepEqual(c.schools, ['浙江大学', '浙江工商大学'])
  assert.deepEqual(c.majors, ['食品科学', '食品科学与工程'])
  assert.equal(c.eduExps.length, 2)
  assert.equal(c.eduExps[0].degree, '博士')
})
test('maps work-exps into workExps', () => {
  const c = mapRawCard(raw)
  assert.deepEqual(c.workExps, [{ company: '浙大', title: '博士研究员' }])
})
test('edu/work fields default to [] when raw lacks them', () => {
  const c = mapRawCard({ ...raw, eduExps: undefined, workExps: undefined })
  assert.deepEqual(c.schools, [])
  assert.deepEqual(c.majors, [])
  assert.deepEqual(c.eduExps, [])
  assert.deepEqual(c.workExps, [])
})
test('majors drops degree token when major slot is missing in the timeline', () => {
  // 教育时间线缺专业 span 时，degree 会落到 major 槽位（[学校, 学历]）
  const c = mapRawCard({ ...raw, eduExps: [{ school: '浙江大学', major: '博士', degree: '' }] })
  assert.deepEqual(c.schools, ['浙江大学'])
  assert.deepEqual(c.majors, []) // 学历不应被当成专业
})
test('maps hasViewed into _hasViewed', () => {
  assert.equal(mapRawCard({ ...raw, hasViewed: true })._hasViewed, true)
  assert.equal(mapRawCard({ ...raw, hasViewed: false })._hasViewed, false)
  assert.equal(mapRawCard(raw)._hasViewed, false)
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
test('expectLabel and expectDirection: 期望 + city+direction', () => {
  const c = mapRawCard({ ...raw, expectLabel: '期望', expect: ['杭州', '化工'] })
  assert.equal(c.expectLabel, '期望')
  assert.equal(c.expectDirection, '化工')
})
test('expectDirection is empty when only city in expect', () => {
  const c = mapRawCard({ ...raw, expectLabel: '最近关注', expect: ['杭州'] })
  assert.equal(c.expectDirection, '')
})
