import { test } from 'node:test'
import assert from 'node:assert/strict'
import generic from './generic.mjs'
import qwen from './qwen.mjs'
import deepseek from './deepseek.mjs'
import glm from './glm.mjs'
import openaiChat from './openai-chat.mjs'
import openaiResponses from './openai-responses.mjs'
import { resolveModelFamily } from '../families.mjs'

const msgs = [{ role: 'user', content: 'hi' }]

test('generic: top-level enable_thinking + thinking_budget + max_tokens', () => {
  const f = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  const req = generic.buildRequest({ family: f, thinking: { enabled: true, budget: 2048 }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'Pro/deepseek-ai/DeepSeek-R1' })
  assert.equal(req.enable_thinking, true)
  assert.equal(req.thinking_budget, 2048)
  assert.equal(req.max_tokens, 500)
})

test('qwen: top-level enable_thinking (not extra_body), stream when thinking', () => {
  const f = resolveModelFamily('qwq-32b')
  const req = qwen.buildRequest({ family: f, thinking: { enabled: true, budget: 1024 }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 800, model: 'qwq-32b' })
  assert.equal(req.enable_thinking, true)
  assert.equal(req.thinking_budget, 1024)
  assert.equal(req.stream, true)
  assert.ok(req.stream_options && req.stream_options.include_usage === true)
})

test('qwen: thinking off → explicit enable_thinking:false, no stream', () => {
  const f = resolveModelFamily('qwen-plus')
  const req = qwen.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'qwen-plus' })
  assert.equal(req.enable_thinking, false)
  assert.equal('stream' in req, false)
})

test('deepseek V4: thinking.type only, never reasoning_effort', () => {
  const f = resolveModelFamily('deepseek-chat')
  const req = deepseek.buildRequest({ family: f, thinking: { enabled: true }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'deepseek-chat' })
  assert.equal(req.thinking && req.thinking.type, 'enabled')
  assert.equal('reasoning_effort' in req, false)
})

test('deepseek reasoner: model name drives thinking, strips sampling', () => {
  const f = resolveModelFamily('deepseek-reasoner')
  const req = deepseek.buildRequest({ family: f, thinking: { enabled: true }, sampling: { temperature: 0.9 }, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'deepseek-reasoner' })
  assert.equal('temperature' in req, false)
})

test('glm: thinking.type string enabled/disabled, no budget', () => {
  const f = resolveModelFamily('glm-4.6')
  const on = glm.buildRequest({ family: f, thinking: { enabled: true }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'glm-4.6' })
  assert.equal(on.thinking.type, 'enabled')
  const off = glm.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'glm-4.6' })
  assert.equal(off.thinking.type, 'disabled')
  assert.equal('thinking_budget' in on, false)
})

test('openai-chat: reasoning_effort + max_completion_tokens, no max_tokens, strips sampling', () => {
  const f = resolveModelFamily('gpt-5')
  const req = openaiChat.buildRequest({ family: f, thinking: { enabled: true, effort: 'medium' }, sampling: { temperature: 0.5 }, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 600, model: 'gpt-5' })
  assert.equal(req.reasoning_effort, 'medium')
  assert.equal(req.max_completion_tokens, 600)
  assert.equal('max_tokens' in req, false)
  assert.equal('temperature' in req, false)
})

test('openai-chat non-reasoning (gpt-4o): never sends reasoning_effort even if thinking on', () => {
  const f = resolveModelFamily('gpt-4o')
  const req = openaiChat.buildRequest({ family: f, thinking: { enabled: true, effort: 'high' }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 600, model: 'gpt-4o' })
  assert.equal('reasoning_effort' in req, false)
})

test('openai-responses: reasoning.effort + max_output_tokens + text.format', () => {
  const f = resolveModelFamily('gpt-5')
  const schema = { name: 'r', schema: { type: 'object' } }
  const req = openaiResponses.buildRequest({ family: f, thinking: { enabled: true, effort: 'high' }, sampling: {}, schema, schemaMode: 'json_schema', messages: msgs, tokenLimit: 700, model: 'gpt-5' })
  assert.equal(req.reasoning.effort, 'high')
  assert.equal(req.max_output_tokens, 700)
  assert.ok(req.text && req.text.format)
})

test('schemaMode downgrade: json_object then prompt-only (generic)', () => {
  const f = resolveModelFamily('qwen-plus')
  const j = generic.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: { name: 'x', schema: {} }, schemaMode: 'json_object', messages: msgs, tokenLimit: 500, model: 'qwen-plus' })
  assert.deepEqual(j.response_format, { type: 'json_object' })
  const p = generic.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: { name: 'x', schema: {} }, schemaMode: 'prompt-only', messages: msgs, tokenLimit: 500, model: 'qwen-plus' })
  assert.equal('response_format' in p, false)
})
