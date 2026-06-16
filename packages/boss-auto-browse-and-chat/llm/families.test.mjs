import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelFamily } from './families.mjs'

test('deepseek-reasoner: reasoning model, ignores sampling, json_object cap', () => {
  const f = resolveModelFamily('deepseek-reasoner')
  assert.equal(f.isReasoningModel, true)
  assert.deepEqual(f.ignoresSampling, ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'])
  assert.equal(f.structuredOutputCap, 'json_object')
})

test('siliconflow-hosted deepseek-r1 path still detected as deepseek reasoner family', () => {
  const f = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  assert.equal(f.isReasoningModel, true)
  assert.equal(f.ignoresSampling.length > 0, true)
})

test('qwq / -thinking → reasoning model', () => {
  assert.equal(resolveModelFamily('qwq-32b').isReasoningModel, true)
  assert.equal(resolveModelFamily('qwen3-235b-a22b-thinking').isReasoningModel, true)
})

test('openai gpt-5 / o-series → reasoning with effort tiers', () => {
  const g = resolveModelFamily('gpt-5')
  assert.equal(g.isReasoningModel, true)
  assert.ok(Array.isArray(g.effortValues) && g.effortValues.includes('medium'))
  assert.equal(resolveModelFamily('o3-mini').isReasoningModel, true)
})

test('plain chat model → not reasoning, full sampling, json_schema cap', () => {
  const f = resolveModelFamily('qwen-plus')
  assert.equal(f.isReasoningModel, false)
  assert.deepEqual(f.ignoresSampling, [])
  assert.equal(f.structuredOutputCap, 'json_schema')
})

test('unknown id → safe defaults (non-reasoning, json_object cap)', () => {
  const f = resolveModelFamily('some-random-model')
  assert.equal(f.isReasoningModel, false)
  assert.equal(f.structuredOutputCap, 'json_object')
})
