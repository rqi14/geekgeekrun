/**
 * glm dialect — 智谱 bigmodel。thinking:{ type:'enabled'|'disabled' }(字符串,非 bool,无 budget)。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'glm',
  label: '智谱 GLM',
  endpoint: 'chat',
  thinkingStyle: 'thinking_type',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /bigmodel\.cn|open\.bigmodel/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    req.thinking = { type: thinking?.enabled ? 'enabled' : 'disabled' }
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') {
      req.response_format = { type: 'json_object' }
    }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
