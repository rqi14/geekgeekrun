import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stopChatWorkerAfterRoundIfNeeded } from './round-completion.ts'

const NORMAL_EXIT_CODE = 0

const exhaustedRound = {
  totalProcessed: 0,
  totalAttempted: 0,
  unreadExhausted: true,
  reachedMaxProcessPerRun: false
}

const needsAnotherRound = {
  totalProcessed: 50,
  totalAttempted: 50,
  unreadExhausted: false,
  reachedMaxProcessPerRun: true
}

test('normal stop returns true after exit so caller can skip rerun scheduling', async () => {
  const events: string[] = []

  const stopped = await stopChatWorkerAfterRoundIfNeeded({
    runOnceAfterComplete: false,
    round: exhaustedRound,
    keepBrowserOpenAfterRun: false,
    browser: {
      close: async () => {
        events.push('close')
      }
    },
    log: (message) => events.push(`log:${message}`),
    exit: (code) => events.push(`exit:${code}`)
  })

  assert.equal(stopped, true)
  assert.deepEqual(events.slice(0, 1), ['close'])
  assert.equal(events.at(-1), `exit:${NORMAL_EXIT_CODE}`)
})

test('active round does not close browser or exit', async () => {
  const events: string[] = []

  const stopped = await stopChatWorkerAfterRoundIfNeeded({
    runOnceAfterComplete: false,
    round: needsAnotherRound,
    keepBrowserOpenAfterRun: false,
    browser: {
      close: async () => {
        events.push('close')
      }
    },
    log: (message) => events.push(`log:${message}`),
    exit: (code) => events.push(`exit:${code}`)
  })

  assert.equal(stopped, false)
  assert.deepEqual(events, [])
})
