import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBossChatPageConfig, toSavePayload } from './mapping.ts'

test('defaults attachment resume PDF download to enabled', () => {
  const state = normalizeBossChatPageConfig({ 'boss-recruiter.json': {} })

  assert.equal(state.chatPage.attachmentResume.skipDownload, false)
})

test('reads existing skipDownload switch', () => {
  const state = normalizeBossChatPageConfig({
    'boss-recruiter.json': {
      chatPage: {
        attachmentResume: {
          skipDownload: true
        }
      }
    }
  })

  assert.equal(state.chatPage.attachmentResume.skipDownload, true)
})

test('writes attachmentResume.skipDownload in chatPage payload', () => {
  const state = normalizeBossChatPageConfig({ 'boss-recruiter.json': {} })
  state.chatPage.attachmentResume.skipDownload = true

  assert.deepEqual(toSavePayload(state).chatPage.attachmentResume, {
    skipDownload: true
  })
})
