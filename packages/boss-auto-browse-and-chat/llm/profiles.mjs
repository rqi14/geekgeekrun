const SO_RANK = { none: 0, json_object: 1, json_schema: 2 }
const SO_BY_RANK = ['none', 'json_object', 'json_schema']

function dialectStructuredCap (dialect) {
  // generic/qwen/openai 支持 json_schema;deepseek/glm 封顶 json_object
  if (dialect.id === 'deepseek' || dialect.id === 'glm') return 'json_object'
  return 'json_schema'
}

function minSo (a, b) {
  return SO_BY_RANK[Math.min(SO_RANK[a] ?? 0, SO_RANK[b] ?? 0)]
}

/**
 * DeepSeek 直连:reasoner(R1)由模型名决定推理(model_name,UI 只读);
 * V4(deepseek-chat 等非推理)用 thinking:{type}(thinking_type,UI 可开关)。
 * 其余 dialect 用各自固定 thinkingStyle。
 */
function effectiveThinkingStyle (dialect, family) {
  if (dialect.id === 'deepseek') {
    return family.isReasoningModel ? 'model_name' : 'thinking_type'
  }
  // OpenAI 非推理模型(gpt-4o/4.1)无 reasoning_effort 能力 → 'none'(UI 不显示思考控件)
  if ((dialect.id === 'openai-chat' || dialect.id === 'openai-responses') && !family.isReasoningModel) {
    return 'none'
  }
  return dialect.thinkingStyle
}

/**
 * resolveModelProfile({ dialect, family, userOverrides }) -> ModelProfile(spec §3.3)。
 */
export function resolveModelProfile ({ dialect, family, userOverrides = {} }) {
  return {
    dialectId: dialect.id,
    endpoint: dialect.endpoint,
    thinkingStyle: effectiveThinkingStyle(dialect, family),
    tokenLimitField: dialect.tokenLimitField,
    unsupportedSampling: [...(family.ignoresSampling || [])],
    structuredOutput: minSo(dialectStructuredCap(dialect), family.structuredOutputCap),
    requiresStreamForThinking: !!dialect.requiresStreamForThinking,
    effortValues: family.effortValues,
    ...userOverrides
  }
}
