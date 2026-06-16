/**
 * 错误分类(无状态)+ 决策(有状态)。spec §3.6。
 */

export class LlmError extends Error {
  constructor (kind, message) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

function readHeader (headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] ?? headers[name.toLowerCase()]
}

function bodyText (err) {
  return JSON.stringify(err?.error ?? err?.response?.data ?? {}) + ' ' + String(err?.message ?? '')
}

/**
 * classifyError(err) -> { kind, retryAfterMs? }。只看错误本身。
 */
export function classifyError (err) {
  if (err instanceof LlmError) return { kind: err.kind }

  const status = err?.status ?? err?.statusCode ?? err?.response?.status
  const code = err?.code ?? err?.error?.code
  const text = bodyText(err).toLowerCase()

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || /network|socket|fetch failed/.test(text)) {
    return { kind: 'network' }
  }
  if (status === 429) {
    const ra = readHeader(err?.headers, 'retry-after')
    const retryAfterMs = ra ? Number(ra) * 1000 : undefined
    if (/insufficient|quota|balance|exceeded your current quota/.test(text)) return { kind: 'quota', retryAfterMs }
    return { kind: 'rate_limit', retryAfterMs }
  }
  if (status === 401 || status === 403) return { kind: 'auth' }
  if (status === 404) return { kind: 'endpoint_unavailable' }
  if (status === 400) {
    if (/response_format|json_schema|text\.format|schema|tool|function/.test(text)) return { kind: 'unsupported_schema' }
    if (/maximum context|context length|too long|reduce the length/.test(text)) return { kind: 'context_overflow' }
    if (/temperature|top_p|unsupported parameter|unknown parameter|reasoning_effort/.test(text)) return { kind: 'unsupported_param' }
    return { kind: 'bad_request' }
  }
  if (typeof status === 'number' && status >= 500) return { kind: 'server' }
  return { kind: 'unknown' }
}

const NEXT_KINDS = new Set(['auth', 'quota', 'unsupported_param', 'context_overflow', 'bad_request', 'unknown'])
const RETRY_KINDS = new Set(['rate_limit', 'server', 'network', 'stream_timeout'])

/**
 * decideNext(kind, state) -> action。state 注入 maxAttemptsPerModel 使其自洽可测。
 */
export function decideNext (kind, state = {}) {
  if (RETRY_KINDS.has(kind)) {
    const { retrySameCount = 0, maxAttemptsPerModel = 2 } = state
    return retrySameCount < maxAttemptsPerModel ? 'retry_same' : 'next_model'
  }
  if (kind === 'endpoint_unavailable') {
    return state.configuredEndpoint === 'auto' && state.currentEndpoint === 'responses'
      ? 'endpoint_downgrade'
      : 'next_model'
  }
  if (kind === 'unsupported_schema' || kind === 'invalid_output') {
    return state.schemaMode && state.schemaMode !== 'prompt-only' ? 'schema_downgrade' : 'next_model'
  }
  if (NEXT_KINDS.has(kind)) return 'next_model'
  return 'next_model'
}
