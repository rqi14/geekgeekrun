import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatComplete } from './chat-complete.mjs'

function fakeClientFactory (captured) {
  return () => ({
    chat: {
      completions: {
        create: async (req) => {
          captured.req = req
          return {
            choices: [{ message: { content: '{"pass":true,"reason":"ok"}', reasoning_content: 'because' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }
        }
      }
    },
    responses: { create: async () => ({ output_text: '{"pass":true,"reason":"r"}', usage: { input_tokens: 1, output_tokens: 1 } }) }
  })
}

const model = {
  baseURL: 'https://api.siliconflow.cn/v1', apiKey: 'sk-x', model: 'Pro/deepseek-ai/DeepSeek-R1',
  brand: 'auto', endpoint: 'auto', thinking: { enabled: true, budget: 2048 }, sampling: { temperature: null }
}

test('builds generic request, returns normalized result with parsed + usage', async () => {
  const captured = {}
  const schema = { name: 'r', schema: { type: 'object', required: ['pass', 'reason'] } }
  const r = await chatComplete(model, [{ role: 'user', content: 'hi' }], {
    schema, schemaMode: 'json_object', maxOutputTokens: 500, _clientFactory: fakeClientFactory(captured)
  })
  assert.equal(captured.req.enable_thinking, true)
  assert.equal(captured.req.max_tokens, 500)
  assert.deepEqual(r.parsed, { pass: true, reason: 'ok' })
  assert.equal(r.usage.prompt, 10)
  assert.equal(r.reasoning, 'because')
  assert.ok(r.raw)
})

test('user sampling.max_tokens overrides maxOutputTokens', async () => {
  const captured = {}
  await chatComplete(
    { ...model, thinking: { enabled: false }, sampling: { max_tokens: 999 } },
    [{ role: 'user', content: 'hi' }],
    { schemaMode: 'none', maxOutputTokens: 500, _clientFactory: fakeClientFactory(captured) }
  )
  assert.equal(captured.req.max_tokens, 999)
})

test('invalid json throws LlmError invalid_output', async () => {
  const factory = () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: 'nope' } }], usage: {} }) } } })
  const schema = { name: 'r', schema: { type: 'object', required: ['pass'] } }
  await assert.rejects(
    chatComplete(model, [{ role: 'user', content: 'hi' }], { schema, schemaMode: 'json_object', _clientFactory: factory }),
    (e) => e.kind === 'invalid_output'
  )
})
