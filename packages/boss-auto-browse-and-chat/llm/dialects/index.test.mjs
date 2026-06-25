import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDialect } from './index.mjs'
import { resolveModelFamily } from '../families.mjs'

test('siliconflow baseURL → generic dialect even for deepseek model', () => {
  const family = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  const d = resolveDialect({ baseURL: 'https://api.siliconflow.cn/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'generic')
})

test('api.deepseek.com → deepseek dialect', () => {
  const family = resolveModelFamily('deepseek-reasoner')
  const d = resolveDialect({ baseURL: 'https://api.deepseek.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'deepseek')
})

test('dashscope → qwen dialect, requiresStreamForThinking', () => {
  const family = resolveModelFamily('qwq-32b')
  const d = resolveDialect({ baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'qwen')
  assert.equal(d.requiresStreamForThinking, true)
})

test('openai auto + reasoning model → openai-responses', () => {
  const family = resolveModelFamily('gpt-5')
  const d = resolveDialect({ baseURL: 'https://api.openai.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'openai-responses')
})

test('openai endpoint locked to chat → openai-chat', () => {
  const family = resolveModelFamily('gpt-5')
  const d = resolveDialect({ baseURL: 'https://api.openai.com/v1', brandLock: 'openai', endpoint: 'chat', family })
  assert.equal(d.id, 'openai-chat')
})

test('brandLock overrides baseURL detection', () => {
  const family = resolveModelFamily('glm-4.6')
  const d = resolveDialect({ baseURL: 'https://unknown.example.com/v1', brandLock: 'glm', endpoint: 'auto', family })
  assert.equal(d.id, 'glm')
})

test('unknown baseURL, auto → generic', () => {
  const family = resolveModelFamily('whatever')
  const d = resolveDialect({ baseURL: 'https://x.example.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'generic')
})
