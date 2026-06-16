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
 * resolveModelProfile({ dialect, family, userOverrides }) -> ModelProfile(spec §3.3)。
 */
export function resolveModelProfile ({ dialect, family, userOverrides = {} }) {
  return {
    dialectId: dialect.id,
    endpoint: dialect.endpoint,
    thinkingStyle: dialect.thinkingStyle,
    tokenLimitField: dialect.tokenLimitField,
    unsupportedSampling: [...(family.ignoresSampling || [])],
    structuredOutput: minSo(dialectStructuredCap(dialect), family.structuredOutputCap),
    requiresStreamForThinking: !!dialect.requiresStreamForThinking,
    effortValues: family.effortValues,
    ...userOverrides
  }
}
