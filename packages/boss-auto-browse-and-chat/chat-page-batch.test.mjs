import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyConversationBatch } from './chat-page-batch.mjs'

test('classifies truly empty DOM as unread exhausted', () => {
  const result = classifyConversationBatch([], new Set(['a']), 10)

  assert.deepEqual(result, {
    batch: [],
    unreadExhausted: true,
    onlySeenVisible: false,
    visibleCount: 0,
    unseenCount: 0
  })
})

test('does not treat visible seen conversations as exhausted', () => {
  const result = classifyConversationBatch([
    { encryptGeekId: 'a', geekName: 'A' },
    { encryptGeekId: 'b', geekName: 'B' },
    { encryptGeekId: 'c', geekName: 'C' }
  ], new Set(['a', 'b', 'c']), 10)

  assert.deepEqual(result, {
    batch: [],
    unreadExhausted: false,
    onlySeenVisible: true,
    visibleCount: 3,
    unseenCount: 0
  })
})

test('returns unseen conversations up to batch size', () => {
  const result = classifyConversationBatch([
    { encryptGeekId: 'a', geekName: 'A' },
    { encryptGeekId: 'b', geekName: 'B' },
    { encryptGeekId: 'c', geekName: 'C' }
  ], new Set(['a']), 1)

  assert.deepEqual(result, {
    batch: [{ encryptGeekId: 'b', geekName: 'B' }],
    unreadExhausted: false,
    onlySeenVisible: false,
    visibleCount: 3,
    unseenCount: 2
  })
})
