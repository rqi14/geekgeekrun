/**
 * resolveModelFamily(modelId) — 仅看 model id,返回能力标志(无状态)。
 * 能力跟 model family(spec §3.2);线格式跟 dialect(见 dialects/)。
 */

const FULL_SAMPLING = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']

/**
 * @param {string} modelId
 * @returns {{ isReasoningModel: boolean, ignoresSampling: string[], structuredOutputCap: 'json_schema'|'json_object'|'none', effortValues?: string[] }}
 */
export function resolveModelFamily (modelId) {
  const id = String(modelId || '').toLowerCase()

  // OpenAI reasoning(gpt-5*, o1/o3/o4 系)→ effort 档位,采样受限
  if (/(^|\/)(o\d)(-|$)/.test(id) || /(^|\/)gpt-5/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: FULL_SAMPLING,
      structuredOutputCap: 'json_schema',
      effortValues: ['low', 'medium', 'high']
    }
  }

  // DeepSeek reasoner(直连或 SiliconFlow 托管的 R1)
  if (/deepseek-?r1|deepseek-reasoner/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: FULL_SAMPLING,
      structuredOutputCap: 'json_object'
    }
  }

  // Qwen 推理(qwq / *-thinking)
  if (/qwq|-thinking(\b|$)/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: [],
      structuredOutputCap: 'json_object'
    }
  }

  // GLM thinking 系(zhipu glm-4.5/4.6,默认动态思考)
  if (/glm-4\.[56]|glm-z1/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: [],
      structuredOutputCap: 'json_object'
    }
  }

  // 普通 chat 模型:已知品牌前缀给 json_schema,其余保守 json_object
  if (/qwen|glm|deepseek|gpt-4|gpt-3|moonshot|kimi/.test(id)) {
    return {
      isReasoningModel: false,
      ignoresSampling: [],
      structuredOutputCap: 'json_schema'
    }
  }

  return {
    isReasoningModel: false,
    ignoresSampling: [],
    structuredOutputCap: 'json_object'
  }
}
