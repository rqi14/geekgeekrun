import { expect, test } from '@playwright/test'
import {
  markManualVerificationAlertShown,
  showManualVerificationAlert
} from '../packages/boss-auto-browse-and-chat/manual-verification-alert.mjs'

test('shows notification and dialog once for a verification alert', async ({ page }) => {
  await page.addInitScript(() => {
    window.__verificationText = '请完成安全验证后继续'
  })
  await page.setContent('<main><div class="verify-container">请完成安全验证后继续</div></main>')
  await expect(page.locator('.verify-container')).toContainText('安全验证')

  const calls = []
  const result = await showManualVerificationAlert({
    key: 'playwright-once',
    state: new Map(),
    now: () => 1000,
    electron: {
      app: {
        setAppUserModelId: (id) => calls.push(['appUserModelId', id])
      },
      Notification: class {
        static isSupported() {
          return true
        }

        constructor(payload) {
          calls.push(['notification:new', payload])
        }

        show() {
          calls.push(['notification:show'])
        }
      },
      dialog: {
        async showMessageBox(payload) {
          calls.push(['dialog', payload])
          return { response: 0 }
        }
      }
    }
  })

  expect(result).toEqual({
    shown: true,
    notificationShown: true,
    dialogShown: true,
    skippedReason: null
  })
  expect(calls.map((call) => call[0])).toEqual([
    'appUserModelId',
    'notification:new',
    'notification:show',
    'dialog'
  ])
  expect(calls.find((call) => call[0] === 'notification:new')[1]).toMatchObject({
    title: 'GeekGeekRun - 需要人工验证'
  })
  expect(calls.find((call) => call[0] === 'dialog')[1]).toMatchObject({
    type: 'warning',
    message: '需要人工验证'
  })
})

test('throttles repeated verification alerts by key', () => {
  const state = new Map()

  expect(
    markManualVerificationAlertShown({
      key: 'same-verification',
      state,
      now: () => 1000,
      cooldownMs: 60_000
    })
  ).toBe(true)
  expect(
    markManualVerificationAlertShown({
      key: 'same-verification',
      state,
      now: () => 30_000,
      cooldownMs: 60_000
    })
  ).toBe(false)
  expect(
    markManualVerificationAlertShown({
      key: 'same-verification',
      state,
      now: () => 61_000,
      cooldownMs: 60_000
    })
  ).toBe(true)
})
