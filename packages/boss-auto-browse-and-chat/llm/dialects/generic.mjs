/**
 * generic dialect — OpenAI 兼容代理(SiliconFlow / 火山 Ark 等)。
 * thinking:顶层 enable_thinking + thinking_budget;token:max_tokens;结构化:Chat response_format。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

function applyStructured (req, schema, schemaMode) {
  if (schemaMode === 'json_schema') {
    req.response_format = { type: 'json_schema', json_schema: schema }
  } else if (schemaMode === 'json_object') {
    req.response_format = { type: 'json_object' }
  }
  // prompt-only / none:不带结构化字段
}

export default {
  id: 'generic',
  label: '通用兼容 / SiliconFlow',
  endpoint: 'chat',
  thinkingStyle: 'top_level_enable',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /siliconflow|ark\.cn-|volces\.com|localhost|127\.0\.0\.1/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: schema } }
    if (schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    if (thinking?.enabled && typeof thinking.budget === 'number') {
      req.enable_thinking = true
      req.thinking_budget = thinking.budget
    }
    applyStructured(req, schema, schemaMode)
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
