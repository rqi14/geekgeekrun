import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldClickX } from './x-guard.mjs'

test('default (undefined) → click X allowed', () => {
  assert.equal(shouldClickX({}), true)
})
test('explicit false → suppressed', () => {
  assert.equal(shouldClickX({ clickNotInterestedForFiltered: false }), false)
})
test('explicit true → allowed', () => {
  assert.equal(shouldClickX({ clickNotInterestedForFiltered: true }), true)
})
test('null cfg → allowed (safe default)', () => {
  assert.equal(shouldClickX(null), true)
})
