import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelProfile } from './profiles.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelFamily } from './families.mjs'

function profileFor (baseURL, modelId, brandLock = 'auto', endpoint = 'auto') {
  const family = resolveModelFamily(modelId)
  const dialect = resolveDialect({ baseURL, brandLock, endpoint, family })
  return resolveModelProfile({ dialect, family, userOverrides: {} })
}

test('siliconflow deepseek-r1: generic dialect + reasoner family', () => {
  const p = profileFor('https://api.siliconflow.cn/v1', 'Pro/deepseek-ai/DeepSeek-R1')
  assert.equal(p.dialectId, 'generic')
  assert.equal(p.thinkingStyle, 'top_level_enable')
  assert.equal(p.tokenLimitField, 'max_tokens')
  assert.ok(p.unsupportedSampling.includes('temperature'))
})

test('structuredOutput = min(dialect cap, family cap): deepseek family caps json_object', () => {
  const p = profileFor('https://api.openai.com/v1', 'gpt-4o')
  assert.equal(p.structuredOutput, 'json_schema')
  const p2 = profileFor('https://api.siliconflow.cn/v1', 'deepseek-reasoner')
  assert.equal(p2.structuredOutput, 'json_object')
})

test('openai gpt-5 auto → responses endpoint + effortValues', () => {
  const p = profileFor('https://api.openai.com/v1', 'gpt-5')
  assert.equal(p.dialectId, 'openai-responses')
  assert.equal(p.endpoint, 'responses')
  assert.deepEqual(p.effortValues, ['low', 'medium', 'high'])
})
