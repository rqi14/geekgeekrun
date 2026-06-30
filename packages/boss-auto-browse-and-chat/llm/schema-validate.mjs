import { LlmError } from './errors.mjs'

function extractJson (content) {
  const s = String(content ?? '').trim()
  // 去 markdown code fence
  const noFence = s.replace(/```(?:json)?/gi, '')
  const m = noFence.match(/\{[\s\S]*\}/)
  return m ? m[0] : noFence
}

/**
 * validateAgainstSchema(content, schema) -> parsed,失败抛 LlmError('invalid_output')。
 * 轻量:JSON.parse + 顶层 required 键存在性(不引入 ajv)。
 */
export function validateAgainstSchema (content, schema) {
  let parsed
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    throw new LlmError('invalid_output', 'response is not valid JSON')
  }
  const required = schema?.schema?.required
  if (Array.isArray(required) && required.length > 0) {
    // 非对象 JSON(如 false / "no" / 42)无法满足 required,且 `in` 会对非对象抛 TypeError
    if (parsed === null || typeof parsed !== 'object') {
      throw new LlmError('invalid_output', 'response JSON is not an object')
    }
    for (const key of required) {
      if (!(key in parsed)) {
        throw new LlmError('invalid_output', `missing required key: ${key}`)
      }
    }
  }
  return parsed
}
