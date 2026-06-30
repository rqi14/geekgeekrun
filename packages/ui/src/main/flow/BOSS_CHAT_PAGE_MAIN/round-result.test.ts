import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  combineChatPageRoundResults,
  shouldStopChatWorkerAfterRound
} from './round-result.ts'

test('stops after a round when every chat job has exhausted unread conversations', () => {
  const round = combineChatPageRoundResults([
    { totalProcessed: 1, totalAttempted: 1, unreadExhausted: true, reachedMaxProcessPerRun: false },
    { totalProcessed: 0, totalAttempted: 0, unreadExhausted: true, reachedMaxProcessPerRun: false }
  ])

  assert.equal(shouldStopChatWorkerAfterRound({ runOnceAfterComplete: false, round }), true)
})

test('continues when any chat job reaches the per-run limit', () => {
  const round = combineChatPageRoundResults([
    { totalProcessed: 50, totalAttempted: 50, unreadExhausted: false, reachedMaxProcessPerRun: true }
  ])

  assert.equal(shouldStopChatWorkerAfterRound({ runOnceAfterComplete: false, round }), false)
})

test('continues conservatively when a result does not report unread exhaustion', () => {
  const round = combineChatPageRoundResults([
    { totalProcessed: 0, totalAttempted: 0, reachedMaxProcessPerRun: false }
  ])

  assert.equal(shouldStopChatWorkerAfterRound({ runOnceAfterComplete: false, round }), false)
})

test('runOnceAfterComplete still stops regardless of round details', () => {
  const round = combineChatPageRoundResults([
    { totalProcessed: 50, totalAttempted: 50, unreadExhausted: false, reachedMaxProcessPerRun: true }
  ])

  assert.equal(shouldStopChatWorkerAfterRound({ runOnceAfterComplete: true, round }), true)
})
