import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRunningOverlayExitAction } from './worker-exit.ts'

const NORMAL_EXIT_CODE = 0
const LOGIN_STATUS_INVALID_EXIT_CODE = 82
const NORMAL_EXITED_STATUS = 1
const ERROR_EXITED_STATUS = 2

test('normal worker exit hides the running overlay', () => {
  assert.deepEqual(getRunningOverlayExitAction(NORMAL_EXIT_CODE), {
    status: NORMAL_EXITED_STATUS,
    analyticsEvent: 'running_overlay_normal_exited',
    shouldHide: true
  })
})

test('error worker exit keeps the running overlay visible', () => {
  assert.deepEqual(getRunningOverlayExitAction(LOGIN_STATUS_INVALID_EXIT_CODE), {
    status: ERROR_EXITED_STATUS,
    analyticsEvent: 'running_overlay_error_exited',
    shouldHide: false
  })
})
