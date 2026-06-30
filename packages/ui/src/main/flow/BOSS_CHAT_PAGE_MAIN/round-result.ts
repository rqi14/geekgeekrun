export type ChatPageProcessResult = {
  totalProcessed?: number
  totalAttempted?: number
  unreadExhausted?: boolean
  reachedMaxProcessPerRun?: boolean
  skipped?: boolean
}

export type ChatPageRoundSummary = {
  totalProcessed: number
  totalAttempted: number
  unreadExhausted: boolean
  reachedMaxProcessPerRun: boolean
}

export const skippedChatPageProcessResult = (): ChatPageProcessResult => ({
  totalProcessed: 0,
  totalAttempted: 0,
  unreadExhausted: true,
  reachedMaxProcessPerRun: false,
  skipped: true
})

const toNonNegativeNumber = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export const normalizeChatPageProcessResult = (
  result: ChatPageProcessResult | null | undefined
): Required<ChatPageProcessResult> => ({
  totalProcessed: toNonNegativeNumber(result?.totalProcessed),
  totalAttempted: toNonNegativeNumber(result?.totalAttempted),
  unreadExhausted: result?.unreadExhausted === true,
  reachedMaxProcessPerRun: result?.reachedMaxProcessPerRun === true,
  skipped: result?.skipped === true
})

export const combineChatPageRoundResults = (
  results: Array<ChatPageProcessResult | null | undefined>
): ChatPageRoundSummary => {
  const normalized = results.map(normalizeChatPageProcessResult)
  const totalProcessed = normalized.reduce((sum, item) => sum + item.totalProcessed, 0)
  const totalAttempted = normalized.reduce((sum, item) => sum + item.totalAttempted, 0)
  const reachedMaxProcessPerRun = normalized.some((item) => item.reachedMaxProcessPerRun)
  const unreadExhausted = normalized.length === 0
    ? true
    : normalized.every((item) => item.unreadExhausted || item.skipped)

  return {
    totalProcessed,
    totalAttempted,
    unreadExhausted,
    reachedMaxProcessPerRun
  }
}

export const shouldStopChatWorkerAfterRound = ({
  runOnceAfterComplete,
  round
}: {
  runOnceAfterComplete: boolean
  round: ChatPageRoundSummary
}): boolean => {
  if (runOnceAfterComplete) return true
  return round.unreadExhausted && !round.reachedMaxProcessPerRun
}
