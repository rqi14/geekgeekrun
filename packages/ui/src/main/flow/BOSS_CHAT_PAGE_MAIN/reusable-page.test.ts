import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chooseChatPageRefreshAction,
  refreshChatPageForNextRound
} from './reusable-page.ts'

const CHAT_URL = 'https://www.zhipin.com/web/chat/index'

test('chooses reload for existing chat URLs', () => {
  assert.equal(chooseChatPageRefreshAction(CHAT_URL, CHAT_URL), 'reload')
  assert.equal(
    chooseChatPageRefreshAction('https://www.zhipin.com/web/chat/session?id=1', CHAT_URL),
    'reload'
  )
})

test('chooses goto when the reusable page is not on chat', () => {
  assert.equal(
    chooseChatPageRefreshAction('https://www.zhipin.com/web/geek/recommend', CHAT_URL),
    'goto'
  )
})

test('refreshes chat page by reloading instead of navigating away', async () => {
  const calls: string[] = []
  const page = {
    url: () => CHAT_URL,
    reload: async () => {
      calls.push('reload')
    },
    goto: async () => {
      calls.push('goto')
    },
    waitForFunction: async () => {
      calls.push('waitForFunction')
    }
  }

  await refreshChatPageForNextRound(page, CHAT_URL)

  assert.deepEqual(calls, ['reload', 'waitForFunction'])
})

test('navigates back to chat when the reusable page is elsewhere', async () => {
  const calls: string[] = []
  const page = {
    url: () => 'https://www.zhipin.com/web/geek/recommend',
    reload: async () => {
      calls.push('reload')
    },
    goto: async (url: string) => {
      calls.push(`goto:${url}`)
    },
    waitForFunction: async () => {
      calls.push('waitForFunction')
    }
  }

  await refreshChatPageForNextRound(page, CHAT_URL)

  assert.deepEqual(calls, [`goto:${CHAT_URL}`, 'waitForFunction'])
})
