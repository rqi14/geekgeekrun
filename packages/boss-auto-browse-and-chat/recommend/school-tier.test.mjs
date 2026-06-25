import { test } from 'node:test'
import assert from 'node:assert/strict'
import { schoolTier } from './school-tier.mjs'

test('985 by full name', () => {
  const r = schoolTier('北京大学')
  assert.equal(r.tier, '985'); assert.equal(r.rank, 5); assert.equal(r.matched, true)
})
test('alias maps to school (北大, 浙大, 中科大)', () => {
  assert.equal(schoolTier('北大').tier, '985')
  assert.equal(schoolTier('浙大').tier, '985')
  assert.equal(schoolTier('中科大').tier, '985')
})
test('case-insensitive english alias', () => {
  assert.equal(schoolTier('PKU').matched, true)
})
test('211 not 985', () => {
  const r = schoolTier('华中农业大学')
  assert.equal(r.p211, true); assert.equal(r.p985, false); assert.equal(r.tier, '211')
})
test('strips parenthetical suffix', () => {
  const r = schoolTier('昆明理工大学(灵长类转化医学国家重点实验室-季维智院士团队)')
  assert.equal(r.matched, true); assert.equal(r.matchedName, '昆明理工大学')
})
test('prefix fallback for 学院 suffix', () => {
  const r = schoolTier('天津大学化工学院')
  assert.equal(r.matched, true); assert.equal(r.matchedName, '天津大学'); assert.equal(r.tier, '985')
})
test('overseas / unknown', () => {
  const r = schoolTier('多伦多大学')
  assert.equal(r.matched, false); assert.equal(r.tier, 'unknown'); assert.equal(r.rank, 0)
})
test('empty/null safe', () => {
  assert.equal(schoolTier('').tier, 'unknown')
  assert.equal(schoolTier(null).tier, 'unknown')
})
test('rank ordering 985>211>双一流>本科>专科>unknown', () => {
  assert.ok(schoolTier('北京大学').rank > schoolTier('华中农业大学').rank)
  assert.ok(schoolTier('华中农业大学').rank > schoolTier('多伦多大学').rank)
})
