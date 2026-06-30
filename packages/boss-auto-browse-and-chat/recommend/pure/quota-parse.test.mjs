import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuotaUsage } from './quota-parse.mjs'

test('解析查看/沟通用量 → used/total/remaining', () => {
  const rows = [
    { name: '今日查看权益消耗', usingText: '7', totalText: '/共20个' },
    { name: '今日沟通权益消耗', usingText: '3', totalText: '/共3个' }
  ]
  const q = parseQuotaUsage(rows)
  assert.deepEqual(q.view, { used: 7, total: 20, remaining: 13 })
  assert.deepEqual(q.greet, { used: 3, total: 3, remaining: 0 })
})

test('剩余不为负', () => {
  const q = parseQuotaUsage([{ name: '今日查看权益消耗', usingText: '25', totalText: '/共20个' }])
  assert.equal(q.view.remaining, 0)
})

test('缺行或脏数据 → null（让调用方回退 cfg）', () => {
  assert.equal(parseQuotaUsage([]).view, null)
  assert.equal(parseQuotaUsage([{ name: '今日查看权益消耗', usingText: '', totalText: '' }]).view, null)
  assert.equal(parseQuotaUsage(null).greet, null)
})
