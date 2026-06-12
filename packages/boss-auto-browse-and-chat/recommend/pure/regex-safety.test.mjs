import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterCandidates } from '../../candidate-processor.mjs'

// 无效正则不应抛错（否则整轮运行崩溃）；按"该规则不生效"处理。
test('invalid blockCandidateNameRegExpStr does not throw, blocks nobody', () => {
  const c = { encryptGeekId: 'a', geekName: '张三', education: '硕士' }
  let res
  assert.doesNotThrow(() => {
    res = filterCandidates([c], { blockCandidateNameRegExpStr: '[' })
  })
  assert.equal(res.matched.length, 1)
})
test('invalid expectEducationRegExpStr does not throw, rule skipped (passes)', () => {
  const c = { encryptGeekId: 'b', geekName: '李四', education: '本科' }
  let res
  assert.doesNotThrow(() => {
    res = filterCandidates([c], { expectEducationRegExpStr: '(' })
  })
  assert.equal(res.matched.length, 1)
})
test('valid education regex still filters', () => {
  const c = { encryptGeekId: 'c', geekName: '王五', education: '本科' }
  const res = filterCandidates([c], { expectEducationRegExpStr: '硕士|博士' })
  assert.equal(res.skipped.length, 1)
  assert.equal(res.skipped[0].filterResult.reason, 'education')
})
