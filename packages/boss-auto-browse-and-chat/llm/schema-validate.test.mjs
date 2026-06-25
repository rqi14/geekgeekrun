import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAgainstSchema } from './schema-validate.mjs'
import { LlmError } from './errors.mjs'

const schema = { name: 'r', schema: { type: 'object', required: ['pass', 'reason'] } }

test('valid json with required keys → parsed', () => {
  const r = validateAgainstSchema('{"pass":true,"reason":"ok"}', schema)
  assert.deepEqual(r, { pass: true, reason: 'ok' })
})

test('extracts json from surrounding text', () => {
  const r = validateAgainstSchema('好的\n{"pass":false,"reason":"x"}\n以上', schema)
  assert.equal(r.pass, false)
})

test('non-json → throws invalid_output', () => {
  assert.throws(() => validateAgainstSchema('not json at all', schema), (e) => e instanceof LlmError && e.kind === 'invalid_output')
})

test('missing required key → throws invalid_output', () => {
  assert.throws(() => validateAgainstSchema('{"pass":true}', schema), (e) => e.kind === 'invalid_output')
})

test('non-object JSON (false) with required keys → invalid_output (not raw TypeError)', () => {
  assert.throws(() => validateAgainstSchema('false', schema), (e) => e.kind === 'invalid_output')
})

test('non-object JSON (string) with required keys → invalid_output', () => {
  assert.throws(() => validateAgainstSchema('"no"', schema), (e) => e.kind === 'invalid_output')
})

test('no schema → parse only, returns parsed', () => {
  assert.deepEqual(validateAgainstSchema('{"a":1}', null), { a: 1 })
})
