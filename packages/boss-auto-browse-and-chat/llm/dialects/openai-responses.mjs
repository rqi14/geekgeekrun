/**
 * openai-responses dialect — OpenAI Responses API。
 * reasoning.effort + max_output_tokens;结构化用 text.format。
 * 注意:Responses API 的 input 与 messages 形态不同 —— buildRequest 产出后,
 * chat-complete.mjs 走 openai.responses.create(见 chat-complete.mjs)。
 */

// Responses API 仅接受 temperature / top_p;frequency_penalty / presence_penalty 是
// Chat Completions 专有,发给 responses.create 会被拒为 unknown parameter。
const RESPONSES_SAMPLING = ['temperature', 'top_p']

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    if (!RESPONSES_SAMPLING.includes(k)) continue
    req[k] = v
  }
}

function buildTextFormat (schema, schemaMode) {
  if (schemaMode === 'json_schema') {
    return { format: { type: 'json_schema', name: schema.name || 'result', schema: schema.schema || schema } }
  }
  if (schemaMode === 'json_object') {
    return { format: { type: 'json_object' } }
  }
  return null
}

export default {
  id: 'openai-responses',
  label: 'OpenAI (Responses)',
  endpoint: 'responses',
  thinkingStyle: 'reasoning_effort',
  tokenLimitField: 'max_output_tokens',
  requiresStreamForThinking: false,
  match () { return false }, // 由 index.mjs 显式选择,不靠 match
  buildStructuredOutput ({ schema, schemaMode }) {
    const t = buildTextFormat(schema, schemaMode)
    return t ? { text: t } : {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, input: messages }
    if (typeof tokenLimit === 'number') req.max_output_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    // reasoning 仅对推理模型有效;非推理模型不应发送
    if (thinking?.enabled && thinking.effort && family.isReasoningModel) req.reasoning = { effort: thinking.effort }
    const t = buildTextFormat(schema, schemaMode)
    if (t) req.text = t
    return req
  },
  parseResponse (raw) {
    // Responses API:output_text 便捷字段;否则遍历 output
    const content = raw?.output_text
      ?? (Array.isArray(raw?.output)
        ? raw.output.flatMap((o) => (o.content || []).map((c) => c.text || '')).join('')
        : '')
    return { content: content ?? '', reasoning: null, raw }
  }
}
