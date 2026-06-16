import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateToV2 } from './runtime-file-utils.mjs'

test('v1 providers → v2: adds brand/endpoint/sampling/thinking, all purposes, retry', () => {
  const v1 = {
    providers: [{ id: 'p', baseURL: 'u', apiKey: 'k', models: [{ id: 'm', model: 'A', enabled: true }] }],
    purposeDefaultModelId: { resume_screening: 'm' }
  }
  const v2 = migrateToV2(v1)
  assert.equal(v2.version, 2)
  const m = v2.providers[0].models[0]
  assert.equal(m.brand, 'auto')
  assert.equal(m.endpoint, 'auto')
  assert.ok(m.sampling && 'temperature' in m.sampling)
  assert.ok(m.thinking && typeof m.thinking.enabled === 'boolean')
  assert.deepEqual(v2.purposes.resume_screening.modelIds, ['m'])
  for (const k of ['resume_screening', 'rubric_generation', 'greeting_generation', 'message_rewrite', 'default']) {
    assert.ok(v2.purposes[k])
  }
  assert.ok(v2.retry.maxAttemptsPerModel >= 1 && 'totalDeadlineMs' in v2.retry)
})

test('flat models[] → v2 providers', () => {
  const flat = { models: [{ id: 'm', baseURL: 'u', apiKey: 'k', model: 'A' }] }
  const v2 = migrateToV2(flat)
  assert.equal(v2.version, 2)
  assert.equal(v2.providers[0].models[0].brand, 'auto')
})

test('invalid known field value → falls back, config not discarded', () => {
  const bad = {
    version: 2,
    providers: [{ id: 'p', baseURL: 'u', apiKey: 'k', models: [{ id: 'm', model: 'A', endpoint: 'weird', enabled: true }] }],
    purposes: {}, retry: { maxAttemptsPerModel: -3 }
  }
  const v2 = migrateToV2(bad)
  assert.equal(v2.providers[0].models[0].endpoint, 'auto') // invalid → default
  assert.ok(v2.retry.maxAttemptsPerModel >= 1) // negative → default
})

test('unknown fields preserved', () => {
  const x = { version: 2, providers: [], purposes: {}, retry: {}, _customField: 42 }
  const v2 = migrateToV2(x)
  assert.equal(v2._customField, 42)
})

test('already-v2 is idempotent', () => {
  const once = migrateToV2({ providers: [], purposeDefaultModelId: {} })
  const twice = migrateToV2(once)
  assert.deepEqual(twice.purposes, once.purposes)
  assert.equal(twice.version, 2)
})
