import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyError, decideNext, LlmError } from './errors.mjs'

test('classifyError: 429 → rate_limit, honors Retry-After', () => {
  const err = Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': '3' } })
  const c = classifyError(err)
  assert.equal(c.kind, 'rate_limit')
  assert.equal(c.retryAfterMs, 3000)
})

test('classifyError: 429 with HTTP-date Retry-After → finite ms, never NaN', () => {
  const future = new Date(Date.now() + 5000).toUTCString()
  const c = classifyError(Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': future } }))
  assert.equal(c.kind, 'rate_limit')
  assert.equal(Number.isFinite(c.retryAfterMs), true)
  assert.ok(c.retryAfterMs >= 0)
})

test('classifyError: 429 with unparseable Retry-After → undefined (not NaN)', () => {
  const c = classifyError(Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': 'garbage' } }))
  assert.equal(c.retryAfterMs, undefined)
})

test('classifyError: 401 → auth', () => {
  assert.equal(classifyError(Object.assign(new Error(), { status: 401 })).kind, 'auth')
})

test('classifyError: 429 insufficient_balance → quota', () => {
  const err = Object.assign(new Error('insufficient_balance'), { status: 429, error: { code: 'insufficient_balance' } })
  assert.equal(classifyError(err).kind, 'quota')
})

test('classifyError: 5xx → server, ECONNRESET → network', () => {
  assert.equal(classifyError(Object.assign(new Error(), { status: 503 })).kind, 'server')
  assert.equal(classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).kind, 'network')
})

test('classifyError: 404 responses route → endpoint_unavailable', () => {
  const err = Object.assign(new Error('not found'), { status: 404 })
  assert.equal(classifyError(err).kind, 'endpoint_unavailable')
})

test('classifyError: local LlmError invalid_output passthrough', () => {
  assert.equal(classifyError(new LlmError('invalid_output', 'bad json')).kind, 'invalid_output')
})

test('decideNext: rate_limit under limit → retry_same, at limit → next_model', () => {
  assert.equal(decideNext('rate_limit', { retrySameCount: 0, maxAttemptsPerModel: 2 }), 'retry_same')
  assert.equal(decideNext('rate_limit', { retrySameCount: 2, maxAttemptsPerModel: 2 }), 'next_model')
})

test('decideNext: endpoint_unavailable only downgrades on auto+responses', () => {
  assert.equal(decideNext('endpoint_unavailable', { configuredEndpoint: 'auto', currentEndpoint: 'responses' }), 'endpoint_downgrade')
  assert.equal(decideNext('endpoint_unavailable', { configuredEndpoint: 'chat', currentEndpoint: 'chat' }), 'next_model')
})

test('decideNext: unsupported_schema/invalid_output downgrade until prompt-only', () => {
  assert.equal(decideNext('unsupported_schema', { schemaMode: 'json_schema' }), 'schema_downgrade')
  assert.equal(decideNext('invalid_output', { schemaMode: 'json_object' }), 'schema_downgrade')
  assert.equal(decideNext('invalid_output', { schemaMode: 'prompt-only' }), 'next_model')
})

test('decideNext: auth/quota/unknown → next_model', () => {
  for (const k of ['auth', 'quota', 'unsupported_param', 'context_overflow', 'bad_request', 'unknown']) {
    assert.equal(decideNext(k, {}), 'next_model')
  }
})
