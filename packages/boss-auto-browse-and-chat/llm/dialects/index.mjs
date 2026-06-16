import generic from './generic.mjs'
import qwen from './qwen.mjs'
import deepseek from './deepseek.mjs'
import glm from './glm.mjs'
import openaiChat from './openai-chat.mjs'
import openaiResponses from './openai-responses.mjs'

// 注册表:brandLock 值 → dialect(openai 特殊,见下)
const BY_BRAND = {
  generic,
  qwen,
  deepseek,
  glm
  // openai 由 endpoint 解析,不在此直查
}

// 自动识别顺序(看 baseURL):先具体后通用,generic 兜底
const AUTO_MATCH = [qwen, deepseek, glm, openaiChat]

function pickOpenAi ({ endpoint, family }) {
  if (endpoint === 'chat') return openaiChat
  if (endpoint === 'responses') return openaiResponses
  // auto:推理模型优先 Responses,否则 Chat
  return family?.isReasoningModel ? openaiResponses : openaiChat
}

/**
 * resolveDialect({ baseURL, brandLock, endpoint, family }) -> dialect 对象。
 * brandLock!=='auto' 只锁 dialect/provider;model family 仍由 resolveModelFamily 决定(正交)。
 */
export function resolveDialect ({ baseURL, brandLock, endpoint, family }) {
  if (brandLock && brandLock !== 'auto') {
    if (brandLock === 'openai') return pickOpenAi({ endpoint, family })
    if (BY_BRAND[brandLock]) return BY_BRAND[brandLock]
    return generic
  }
  // auto:OpenAI 域名 → openai 组
  if (/api\.openai\.com/i.test(String(baseURL || ''))) return pickOpenAi({ endpoint, family })
  for (const d of AUTO_MATCH) {
    if (d.match({ baseURL, endpoint })) return d
  }
  return generic
}

export { generic, qwen, deepseek, glm, openaiChat, openaiResponses }
