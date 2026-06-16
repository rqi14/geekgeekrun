import OpenAI from 'openai'
import { resolveModelFamily } from './families.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelProfile } from './profiles.mjs'
import { validateAgainstSchema } from './schema-validate.mjs'
import { normalizeUsage } from './usage.mjs'

const DEFAULT_TIMEOUT_MS = 60000

function defaultClientFactory (model) {
  return new OpenAI({ baseURL: model.baseURL, apiKey: model.apiKey })
}

function initSchemaMode (schema, profile) {
  if (!schema) return 'none'
  if (profile.structuredOutput === 'none') return 'prompt-only'
  return profile.structuredOutput // json_schema | json_object
}

function mergeSampling (model, optsSampling) {
  return { ...(model.sampling || {}), ...(optsSampling || {}) }
}

function injectSchemaPrompt (messages, schema) {
  // prompt-only 模式:把 schema 描述追加进 system / 末条
  const hint = `\n\n请严格输出符合该 JSON Schema 的 JSON,不要任何多余文字:\n${JSON.stringify(schema?.schema ?? schema)}`
  const copy = messages.map((m) => ({ ...m }))
  const sys = copy.find((m) => m.role === 'system')
  if (sys) sys.content += hint
  else copy.unshift({ role: 'system', content: hint.trim() })
  return copy
}

async function aggregateStream (stream) {
  let content = ''
  let reasoning = ''
  let usage = null
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta ?? {}
    if (delta.content) content += delta.content
    if (delta.reasoning_content) reasoning += delta.reasoning_content
    if (chunk?.usage) usage = chunk.usage
  }
  return { choices: [{ message: { content, reasoning_content: reasoning || null } }], usage }
}

/**
 * chatComplete(model, messages, opts) — 单次调用,按 opts.schemaMode 构造一次(不自循环降级)。
 * opts: { schema, sampling, maxOutputTokens, schemaMode, signal, timeoutMs, _clientFactory }
 */
export async function chatComplete (model, messages, opts = {}) {
  const family = resolveModelFamily(model.model)
  const dialect = resolveDialect({
    baseURL: model.baseURL, brandLock: model.brand, endpoint: model.endpoint, family
  })
  const profile = resolveModelProfile({ dialect, family, userOverrides: {} })

  const schema = opts.schema ?? null
  const schemaMode = opts.schemaMode ?? initSchemaMode(schema, profile)

  const sampling = mergeSampling(model, opts.sampling)
  const tokenLimit = typeof sampling.max_tokens === 'number' ? sampling.max_tokens : opts.maxOutputTokens
  // max_tokens 已并入 tokenLimit,避免 buildRequest 重复写采样
  const samplingForBuild = { ...sampling }
  delete samplingForBuild.max_tokens

  let outMessages = messages
  if (schemaMode === 'prompt-only' && schema) outMessages = injectSchemaPrompt(messages, schema)

  const req = dialect.buildRequest({
    family, thinking: model.thinking || {}, sampling: samplingForBuild,
    schema, schemaMode, messages: outMessages, tokenLimit, model: model.model
  })

  const client = (opts._clientFactory ? opts._clientFactory(model) : defaultClientFactory(model))
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let raw
  if (profile.endpoint === 'responses') {
    raw = await client.responses.create(req, { signal })
  } else if (req.stream) {
    const stream = await client.chat.completions.create(req, { signal })
    raw = await aggregateStream(stream)
  } else {
    raw = await client.chat.completions.create(req, { signal })
  }

  const { content, reasoning } = dialect.parseResponse(raw)
  const usage = normalizeUsage(raw?.usage)

  let parsed
  if (schema) parsed = validateAgainstSchema(content, schema) // 失败抛 invalid_output

  // raw 仅进程内,不外传
  return { content, parsed, reasoning, usage, raw }
}
