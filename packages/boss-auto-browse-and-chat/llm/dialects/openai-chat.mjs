/**
 * openai-chat dialect — OpenAI Chat Completions 兼容。
 * reasoning_effort + max_completion_tokens(不用 max_tokens);推理模型限制采样;结构化用 response_format。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'openai-chat',
  label: 'OpenAI (Chat)',
  endpoint: 'chat',
  thinkingStyle: 'reasoning_effort',
  tokenLimitField: 'max_completion_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /api\.openai\.com/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: schema } }
    if (schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_completion_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    // reasoning_effort 仅对推理模型有效;发给 gpt-4o 等非推理模型会被 OpenAI 拒为 unsupported parameter
    if (thinking?.enabled && thinking.effort && family.isReasoningModel) req.reasoning_effort = thinking.effort
    if (schemaMode === 'json_schema') req.response_format = { type: 'json_schema', json_schema: schema }
    else if (schemaMode === 'json_object') req.response_format = { type: 'json_object' }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
