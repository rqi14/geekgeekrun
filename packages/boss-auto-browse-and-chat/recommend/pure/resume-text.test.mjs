import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterFontTestLines } from './resume-text.mjs'

test('从首个含"活跃"的行开始保留，丢弃之前的字体预热噪声', () => {
  const lines = ['宋体', 'abc', '最近活跃', '张三', '本科']
  assert.deepEqual(filterFontTestLines(lines), ['最近活跃', '张三', '本科'])
})

test('无"活跃"行时，兜底丢弃不含汉字的行', () => {
  const lines = ['abc', '123', '张三', 'def', '本科 5年']
  assert.deepEqual(filterFontTestLines(lines), ['张三', '本科 5年'])
})
