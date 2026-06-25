import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageForSaveFilter } from './chat-list.ts'

const base = { status: 1, templateId: 1, messageType: 'text' }

test('keeps a normal text message', () => {
  assert.equal(messageForSaveFilter({ ...base }), true)
})

test('drops system notification (status 3)', () => {
  assert.equal(messageForSaveFilter({ ...base, status: 3 }), false)
})

test('drops non-user template (templateId !== 1)', () => {
  assert.equal(messageForSaveFilter({ ...base, templateId: 0 }), false)
})

test('drops auto greeting-question answer', () => {
  assert.equal(
    messageForSaveFilter({ ...base, extend: { greetingQuestionAnswer: 'x' } }),
    false
  )
})

test('keeps a whitelisted dialog type, drops a non-whitelisted one', () => {
  assert.equal(
    messageForSaveFilter({ ...base, messageType: 'dialog', dialog: { type: 8 } }),
    true
  )
  assert.equal(
    messageForSaveFilter({ ...base, messageType: 'dialog', dialog: { type: 99 } }),
    false
  )
})

test('drops unknown message type', () => {
  assert.equal(messageForSaveFilter({ ...base, messageType: 'video' }), false)
})
