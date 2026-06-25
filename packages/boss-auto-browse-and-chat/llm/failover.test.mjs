import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelChain, chatCompleteForPurpose } from './failover.mjs'
import { LlmError } from './errors.mjs'

const config = {
  version: 2,
  providers: [{
    id: 'p1', baseURL: 'https://api.siliconflow.cn/v1', apiKey: 'sk-1',
    models: [
      { id: 'm1', model: 'A', enabled: true, brand: 'auto', endpoint: 'auto', thinking: {}, sampling: {} },
      { id: 'm2', model: 'B', enabled: true, brand: 'auto', endpoint: 'auto', thinking: {}, sampling: {} }
    ]
  }],
  purposes: { resume_screening: { modelIds: ['m2', 'm1'] }, default: { modelIds: ['m1'] } },
  retry: { maxAttemptsPerModel: 2, backoffMs: 1, maxBackoffMs: 10, totalDeadlineMs: 5000 }
}

test('resolveModelChain: purpose chain first', () => {
  const chain = resolveModelChain(config, 'resume_screening')
  assert.deepEqual(chain.map((m) => m.id), ['m2', 'm1'])
})

test('resolveModelChain: empty purpose → default chain', () => {
  const chain = resolveModelChain({ ...config, purposes: { rubric_generation: { modelIds: [] }, default: { modelIds: ['m1'] } } }, 'rubric_generation')
  assert.deepEqual(chain.map((m) => m.id), ['m1'])
})

test('resolveModelChain: empty purpose+default → global enabled order', () => {
  const chain = resolveModelChain({ ...config, purposes: { default: { modelIds: [] } } }, 'x')
  assert.deepEqual(chain.map((m) => m.id), ['m1', 'm2'])
})

test('resolveModelChain: preferModelId hoisted to front, rest kept as fallback', () => {
  const chain = resolveModelChain(config, 'resume_screening', 'm1')
  assert.deepEqual(chain.map((m) => m.id), ['m1', 'm2'])
})

test('resolveModelChain: unknown preferModelId ignored', () => {
  const chain = resolveModelChain(config, 'resume_screening', 'nope')
  assert.deepEqual(chain.map((m) => m.id), ['m2', 'm1'])
})

test('success on first model', async () => {
  const fake = async (model) => ({ content: 'ok', parsed: { v: model.model }, usage: {}, raw: {} })
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake })
  assert.equal(r.parsed.v, 'B') // m2 first
})

test('passes remaining-budget timeoutMs to chatComplete (bounds single call)', async () => {
  let seen
  const fake = async (model, msgs, opts) => {
    seen = opts.timeoutMs
    return { content: 'ok', parsed: { ok: true }, usage: {}, raw: {} }
  }
  await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake })
  assert.equal(typeof seen, 'number')
  assert.ok(seen > 0 && seen <= config.retry.totalDeadlineMs)
})

test('maxAttemptsPerModel=0 disables retry_same → straight to next_model', async () => {
  const cfg0 = { ...config, retry: { ...config.retry, maxAttemptsPerModel: 0 }, purposes: { resume_screening: { modelIds: ['m1'] }, default: { modelIds: [] } } }
  let calls = 0
  const fake = async () => { calls++; throw Object.assign(new Error('rl'), { status: 429 }) }
  await assert.rejects(
    chatCompleteForPurpose(cfg0, 'resume_screening', [], { _chatComplete: fake, _sleep: async () => {} }),
    () => true
  )
  assert.equal(calls, 1) // first send only, no retry
})

test('rate_limit retries same model then succeeds', async () => {
  let n = 0
  const fake = async () => {
    n++
    if (n < 2) throw Object.assign(new Error('rl'), { status: 429 })
    return { content: 'ok', parsed: { n }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake, _sleep: async () => {} })
  assert.equal(r.parsed.n, 2)
})

test('auth → next model immediately', async () => {
  const calls = []
  const fake = async (model) => {
    calls.push(model.id)
    if (model.id === 'm2') throw Object.assign(new Error('auth'), { status: 401 })
    return { content: 'ok', parsed: { id: model.id }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake })
  assert.deepEqual(calls, ['m2', 'm1'])
  assert.equal(r.parsed.id, 'm1')
})

test('schema downgrade walks chain within same model', async () => {
  const modes = []
  const fake = async (model, msgs, opts) => {
    modes.push(opts.schemaMode)
    if (opts.schemaMode !== 'prompt-only') throw new LlmError('invalid_output', 'bad')
    return { content: 'ok', parsed: { ok: true }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(
    { ...config, purposes: { resume_screening: { modelIds: ['m1'] }, default: { modelIds: [] } } },
    'resume_screening', [], { schema: { name: 'r', schema: { type: 'object' } }, _chatComplete: fake, _sleep: async () => {} }
  )
  assert.deepEqual(modes, ['json_object', 'prompt-only'])
  assert.equal(r.parsed.ok, true)
})

test('all fail → aggregate error, no apiKey leak', async () => {
  const fake = async () => { throw Object.assign(new Error('boom sk-1 secret'), { status: 500 }) }
  await assert.rejects(
    chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake, _sleep: async () => {} }),
    (e) => /all models failed/i.test(e.message) && !/sk-1/.test(e.message)
  )
})
