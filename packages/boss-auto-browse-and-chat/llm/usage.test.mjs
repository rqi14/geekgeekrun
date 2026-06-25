import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsage } from './usage.mjs'

test('chat usage with reasoning + cached', () => {
  const u = normalizeUsage({
    prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
    completion_tokens_details: { reasoning_tokens: 20 },
    prompt_tokens_details: { cached_tokens: 30 }
  })
  assert.deepEqual(u, { prompt: 100, completion: 50, reasoning: 20, cached: 30, total: 150 })
})

test('responses usage shape', () => {
  const u = normalizeUsage({ input_tokens: 80, output_tokens: 40, total_tokens: 120, output_tokens_details: { reasoning_tokens: 10 } })
  assert.equal(u.prompt, 80)
  assert.equal(u.completion, 40)
  assert.equal(u.reasoning, 10)
})

test('missing usage → all zero', () => {
  assert.deepEqual(normalizeUsage(null), { prompt: 0, completion: 0, reasoning: 0, cached: 0, total: 0 })
})
