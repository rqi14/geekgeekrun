/**
 * normalizeUsage(raw) -> { prompt, completion, reasoning, cached, total }。
 * 兼容 Chat Completions 与 Responses API 的 usage 形态。
 */
export function normalizeUsage (u) {
  if (!u || typeof u !== 'object') {
    return { prompt: 0, completion: 0, reasoning: 0, cached: 0, total: 0 }
  }
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0
  const completion = u.completion_tokens ?? u.output_tokens ?? 0
  const reasoning = u.completion_tokens_details?.reasoning_tokens
    ?? u.output_tokens_details?.reasoning_tokens
    ?? 0
  const cached = u.prompt_tokens_details?.cached_tokens
    ?? u.input_tokens_details?.cached_tokens
    ?? 0
  const total = u.total_tokens ?? (prompt + completion)
  return { prompt, completion, reasoning, cached, total }
}
