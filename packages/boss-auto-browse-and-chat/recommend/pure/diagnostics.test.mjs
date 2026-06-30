import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateDebugLabel,
  summarizeOpenOrder,
  summarizeScoreResult,
  summarizeGreetSelection
} from './diagnostics.mjs'

test('candidateDebugLabel includes name and short encrypted id', () => {
  assert.equal(
    candidateDebugLabel({ geekName: 'Alice', encryptGeekId: 'abcdef1234567890' }),
    'Alice#abcdef'
  )
})

test('summarizeOpenOrder exposes ranking inputs without resume text', () => {
  const result = summarizeOpenOrder(
    [
      {
        geekName: 'Alice',
        encryptGeekId: 'abcdef1234567890',
        _schoolRank: 4,
        _hasViewed: true,
        activeText: 'today',
        fullText: 'this must not appear'
      }
    ],
    (c) => c._schoolRank * 1000 + 42
  )

  assert.deepEqual(result, [
    {
      rank: 1,
      candidate: 'Alice#abcdef',
      prescore: 4042,
      schoolRank: 4,
      hasViewed: true,
      activeText: 'today'
    }
  ])
})

test('summarizeScoreResult keeps decision fields compact', () => {
  const result = summarizeScoreResult({
    candidate: { geekName: 'Bob', encryptGeekId: 'zzzzzz987654' },
    score: 83,
    hardReject: false,
    reason: 'matches rubric',
    resumeChars: 1200,
    summaryChars: 90,
    canvasOk: true,
    llmError: false
  })

  assert.deepEqual(result, {
    candidate: 'Bob#zzzzzz',
    score: 83,
    hardReject: false,
    reason: 'matches rubric',
    resumeChars: 1200,
    summaryChars: 90,
    canvasOk: true,
    llmError: false
  })
})

test('summarizeGreetSelection marks selected and skipped candidates', () => {
  const scored = [
    { candidate: { geekName: 'A', encryptGeekId: 'aaaaaa' }, score: 90, hardReject: false },
    { candidate: { geekName: 'B', encryptGeekId: 'bbbbbb' }, score: 59, hardReject: false },
    { candidate: { geekName: 'C', encryptGeekId: 'cccccc' }, score: 95, hardReject: true }
  ]
  const selected = [scored[0]]

  assert.deepEqual(summarizeGreetSelection(scored, selected, 60), [
    { rank: 1, candidate: 'A#aaaaaa', score: 90, selected: true, skippedReason: '' },
    { rank: 2, candidate: 'C#cccccc', score: 95, selected: false, skippedReason: 'hardReject' },
    { rank: 3, candidate: 'B#bbbbbb', score: 59, selected: false, skippedReason: 'belowThreshold' }
  ])
})
