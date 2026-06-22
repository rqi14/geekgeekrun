import OpenAI from 'openai'
import { resolveModelFamily } from './families.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelProfile } from './profiles.mjs'
import { validateAgainstSchema } from './schema-validate.mjs'
import { normalizeUsage } from './usage.mjs'
import { LlmError } from './errors.mjs'

const DEFAULT_TIMEOUT_MS = 60000
const STREAM_IDLE_MS = 30000

function defaultClientFactory (model) {
  // maxRetries: 0 —— 所有重试由 failover 层(classifyError/decideNext + maxAttemptsPerModel)统一管理;
  // 否则 SDK 默认会先内部重试 429/5xx,绕过失败策略并吃掉 totalDeadlineMs。
  return new OpenAI({ baseURL: model.baseURL, apiKey: model.apiKey, maxRetries: 0 })
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

/**
 * 流式调用 + 聚合(Qwen thinking 用)。在总超时之外附加「流空闲超时」:每个 chunk 重置计时,
 * 超过 idleMs 没有新 chunk 即中止,归类为可重试的 stream_timeout(spec §3.5 step 5)。
 */
async function streamChat (client, req, totalSignal, idleMs) {
  const idle = new AbortController()
  let timer
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => idle.abort(), idleMs)
  }
  const signal = typeof AbortSignal.any === 'function'
    ? AbortSignal.any([totalSignal, idle.signal])
    : totalSignal
  arm()
  try {
    const stream = await client.chat.completions.create(req, { signal })
    let content = ''
    let reasoning = ''
    let usage = null
    for await (const chunk of stream) {
      arm()
      const delta = chunk?.choices?.[0]?.delta ?? {}
      if (delta.content) content += delta.content
      if (delta.reasoning_content) reasoning += delta.reasoning_content
      if (chunk?.usage) usage = chunk.usage
    }
    return { choices: [{ message: { content, reasoning_content: reasoning || null } }], usage }
  } catch (err) {
    if (idle.signal.aborted) throw new LlmError('stream_timeout', 'stream idle timeout')
    throw err
  } finally {
    clearTimeout(timer)
  }
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
  // 用户在高级参数显式填的 max_tokens 原样尊重;否则用用途默认(maxOutputTokens)。
  const userMaxTokens = typeof sampling.max_tokens === 'number' ? sampling.max_tokens : null
  let tokenLimit = userMaxTokens ?? opts.maxOutputTokens
  // 推理模型:用途默认是「期望输出长度」,需在其上预留 reasoning 空间,否则 completion 上限
  // 低于 thinking 预算会被截断/拒绝(如 DeepSeek-R1 + resume_screening=500)。仅对默认值加,
  // 用户显式值不动(用户自负其责)。
  const isReasoning = family.isReasoningModel || !!(model.thinking && model.thinking.enabled)
  if (userMaxTokens === null && isReasoning && typeof tokenLimit === 'number') {
    const budget = typeof model.thinking?.budget === 'number' ? model.thinking.budget : 2048
    tokenLimit = tokenLimit + budget
  }
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
    raw = await streamChat(client, req, signal, opts.idleMs ?? STREAM_IDLE_MS)
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
