/**
 * deepseek dialect — api.deepseek.com 直连。
 * reasoner:模型名=开,忽略采样;V4(deepseek-chat):thinking:{type} only(不发 reasoning_effort,spec §3.4)。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'deepseek',
  label: 'DeepSeek 直连',
  endpoint: 'chat',
  thinkingStyle: 'model_name',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /api\.deepseek\.com/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    // reasoner 支持 JSON 输出,不支持 json_schema 严格模式 → 用 json_object
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    const isReasonerByName = /reasoner|r1/i.test(String(model))
    if (thinking?.enabled && !isReasonerByName) {
      // V4 系:thinking.type;绝不发 reasoning_effort
      req.thinking = { type: 'enabled' }
    } else if (!thinking?.enabled && !isReasonerByName) {
      req.thinking = { type: 'disabled' }
    }
    // reasoner:由模型名决定,不加字段
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') {
      req.response_format = { type: 'json_object' }
    }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    // 注意:reasoning_content 不能回传进 input(spec §3.4),此处仅读不回写
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
