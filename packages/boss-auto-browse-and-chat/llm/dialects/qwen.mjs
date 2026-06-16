/**
 * qwen dialect — DashScope 兼容模式。Node openai SDK 用顶层字段(extra_body 是 Python 写法)。
 * thinking 时必须 stream;由 chat-complete.mjs 内部聚合 reasoning_content + content。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'qwen',
  label: '通义千问 Qwen / DashScope',
  endpoint: 'chat',
  thinkingStyle: 'qwen_enable',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: true,
  match ({ baseURL }) {
    return /dashscope\.aliyuncs\.com|aliyuncs/i.test(String(baseURL || ''))
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
    if (thinking?.enabled) {
      req.enable_thinking = true
      if (typeof thinking.budget === 'number') req.thinking_budget = thinking.budget
      req.stream = true
      req.stream_options = { include_usage: true }
    }
    if (schemaMode === 'json_schema') req.response_format = { type: 'json_schema', json_schema: schema }
    else if (schemaMode === 'json_object') req.response_format = { type: 'json_object' }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
