import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cheapPrescore } from './prescore.mjs'

test('higher degree scores higher', () => {
  const phd = cheapPrescore({ education: '博士', tags: [] })
  const bsc = cheapPrescore({ education: '本科', tags: [] })
  assert.ok(phd > bsc)
})
test('QS/985/211 tags add points', () => {
  const tagged = cheapPrescore({ education: '硕士', tags: ['QS前500院校'] })
  const plain = cheapPrescore({ education: '硕士', tags: [] })
  assert.ok(tagged > plain)
})
test('missing fields do not throw and score finite', () => {
  const s = cheapPrescore({})
  assert.ok(Number.isFinite(s))
})
