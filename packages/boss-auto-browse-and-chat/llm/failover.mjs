import { classifyError, decideNext } from './errors.mjs'
import { chatComplete as realChatComplete } from './chat-complete.mjs'
import { resolveModelFamily } from './families.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelProfile } from './profiles.mjs'

const SCHEMA_CHAIN = ['json_schema', 'json_object', 'prompt-only']

function flattenEnabled (config) {
  const out = []
  for (const p of config.providers || []) {
    for (const m of p.models || []) {
      if (m.enabled === false) continue
      out.push({ ...m, baseURL: p.baseURL, apiKey: p.apiKey })
    }
  }
  return out
}

/**
 * resolveModelChain(config, purpose, preferModelId) — 三级回落:purpose → default → 全局启用顺序。
 * preferModelId(用户在 UI 显式选定的模型,如评分/ rubric 生成)若存在且启用,置于链首(去重),
 * 既尊重用户选择,又保留其余模型作为 failover 兜底。
 */
export function resolveModelChain (config, purpose, preferModelId = null) {
  const all = flattenEnabled(config)
  const byId = (ids) => (ids || []).map((id) => all.find((m) => m.id === id)).filter(Boolean)

  let chain
  const p = byId(config.purposes?.[purpose]?.modelIds)
  if (p.length) chain = p
  else {
    const d = byId(config.purposes?.default?.modelIds)
    chain = d.length ? d : all
  }

  if (preferModelId) {
    const preferred = all.find((m) => m.id === preferModelId)
    if (preferred) {
      chain = [preferred, ...chain.filter((m) => m.id !== preferModelId)]
    }
  }
  return chain
}

function profileFor (model, endpoint) {
  const family = resolveModelFamily(model.model)
  const dialect = resolveDialect({ baseURL: model.baseURL, brandLock: model.brand, endpoint, family })
  return resolveModelProfile({ dialect, family, userOverrides: {} })
}

function initSchemaMode (model, schema) {
  if (!schema) return 'none'
  const profile = profileFor(model, model.endpoint)
  return profile.structuredOutput === 'none' ? 'prompt-only' : profile.structuredOutput
}

function redact (msg, model) {
  let s = String(msg ?? '')
  if (model?.apiKey) s = s.split(model.apiKey).join('***')
  return s.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * chatCompleteForPurpose(config, purpose, messages, opts)。
 * opts: { schema, maxOutputTokens, sampling, preferModelId, _chatComplete, _sleep }
 */
export async function chatCompleteForPurpose (config, purpose, messages, opts = {}) {
  const chat = opts._chatComplete || realChatComplete
  const sleep = opts._sleep || defaultSleep
  const retry = config.retry || { maxAttemptsPerModel: 2, backoffMs: 500, maxBackoffMs: 20000, totalDeadlineMs: 120000 }
  const chain = resolveModelChain(config, purpose, opts.preferModelId ?? null)
  const deadline = Date.now() + (retry.totalDeadlineMs ?? 120000)
  const failures = []

  for (const model of chain) {
    let currentEndpoint = model.endpoint === 'auto' ? profileFor(model, 'auto').endpoint : model.endpoint
    let schemaMode = initSchemaMode(model, opts.schema)
    let retrySameCount = 0
    let working = { ...model, endpoint: currentEndpoint }

    // 同模型循环:retry_same / endpoint_downgrade / schema_downgrade
    // 上限 = retry_same 次数 + 确定性降级步数(schema 链各级 + 1 次 endpoint 降级)+ 首发,
    // 由实际步数推出,不用魔数。
    const guardMax = retry.maxAttemptsPerModel + SCHEMA_CHAIN.length + 2
    let advanced = false
    for (let guard = 0; guard < guardMax; guard++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        failures.push({ id: model.id, kind: 'deadline' })
        return throwAggregate(failures)
      }
      try {
        // 用剩余预算给单次调用设上限,使 totalDeadlineMs 真正约束整条 failover
        return await chat(working, messages, {
          schema: opts.schema, sampling: opts.sampling, maxOutputTokens: opts.maxOutputTokens, schemaMode, timeoutMs: remaining
        })
      } catch (err) {
        const { kind, retryAfterMs } = classifyError(err)
        const action = decideNext(kind, {
          retrySameCount, maxAttemptsPerModel: retry.maxAttemptsPerModel,
          configuredEndpoint: model.endpoint, currentEndpoint, schemaMode
        })
        if (action === 'retry_same') {
          retrySameCount++
          const expBackoff = retry.backoffMs * Math.pow(2, retrySameCount - 1)
          const base = Number.isFinite(retryAfterMs) ? retryAfterMs : expBackoff
          const backoff = Math.min(base, retry.maxBackoffMs ?? 20000)
          const jitter = backoff * 0.2 * ((retrySameCount % 3) / 3) // 确定性 jitter(不用 Math.random)
          // 退避也受总预算约束,避免 sleep 超出 totalDeadlineMs
          const cappedSleep = Math.min(backoff + jitter, Math.max(0, deadline - Date.now()))
          await sleep(cappedSleep)
          continue
        }
        if (action === 'endpoint_downgrade') {
          currentEndpoint = 'chat'
          working = { ...working, endpoint: 'chat' }
          continue
        }
        if (action === 'schema_downgrade') {
          const idx = SCHEMA_CHAIN.indexOf(schemaMode)
          schemaMode = SCHEMA_CHAIN[Math.min(idx + 1, SCHEMA_CHAIN.length - 1)]
          continue
        }
        // next_model
        failures.push({ id: model.id, kind, reason: redact(err.message, model) })
        advanced = true
        break
      }
    }
    // guard 用尽仍未 return/换模型 → 记录,避免聚合错误漏掉该模型
    if (!advanced) failures.push({ id: model.id, kind: 'exhausted' })
  }
  return throwAggregate(failures)
}

function throwAggregate (failures) {
  const detail = failures.map((f) => `${f.id}:${f.kind}`).join(', ')
  const e = new Error(`all models failed [${detail}]`)
  e.failures = failures
  throw e
}
