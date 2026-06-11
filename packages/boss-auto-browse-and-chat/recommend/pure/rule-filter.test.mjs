import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleFilterList } from './rule-filter.mjs'

const cfg = { expectEducationList: ['硕士', '博士'], expectSalaryRange: [10, 30], expectSalaryWhenNegotiable: 'include' }

test('passes a matching candidate', () => {
  const c = { encryptGeekId: 'a', geekName: '甲', education: '硕士', salary: '10-15K' }
  assert.deepEqual(ruleFilterList(c, cfg), { result: 'pass' })
})
test('rejects on education with reason', () => {
  const c = { encryptGeekId: 'b', geekName: '乙', education: '本科', salary: '10-15K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'education')
})
test('rejects on salary too high', () => {
  const c = { encryptGeekId: 'c', geekName: '丙', education: '硕士', salary: '40-50K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'salary')
})
