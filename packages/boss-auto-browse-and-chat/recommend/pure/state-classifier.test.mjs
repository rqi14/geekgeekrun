import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyState, STATES } from './state-classifier.mjs'

const base = { mainText: '', mainOverlayClasses: [], frameOverlayClasses: [], frameHasList: true, verify: false }

test('ACCOUNT_BANNED beats everything', () => {
  const s = classifyState({ ...base, mainText: '您的账号当前处于不可使用状态，请登录BOSS直聘手机APP查看详情', frameOverlayClasses: ['dialog-wrap active'] })
  assert.equal(s, STATES.ACCOUNT_BANNED)
})
test('VERIFY when risk-detector flag set', () => {
  assert.equal(classifyState({ ...base, verify: true }), STATES.VERIFY)
})
test('RESUME_MODAL when frame has dialog-lib-resume', () => {
  assert.equal(classifyState({ ...base, frameOverlayClasses: ['dialog-wrap active dialog-lib-resume'] }), STATES.RESUME_MODAL)
})
test('LIST_REASON_PANEL on card-reason-f1 show', () => {
  assert.equal(classifyState({ ...base, frameOverlayClasses: ['card-reason-f1 show'] }), STATES.LIST_REASON_PANEL)
})
test('RESUME_REJECT_DIALOG on main feedback-wrap', () => {
  assert.equal(classifyState({ ...base, mainOverlayClasses: ['dialog-wrap active'], mainText: '选择原因，推荐更合适牛人 提交' }), STATES.RESUME_REJECT_DIALOG)
})
test('GOVERNANCE_NOTICE on dialog-uninstall-extension', () => {
  assert.equal(classifyState({ ...base, mainOverlayClasses: ['dialog-uninstall-extension'] }), STATES.GOVERNANCE_NOTICE)
})
test('QUOTA_BLOCKED on quota text', () => {
  assert.equal(classifyState({ ...base, mainText: '今日打招呼已达上限' }), STATES.QUOTA_BLOCKED)
})
test('LIST when clean', () => {
  assert.equal(classifyState(base), STATES.LIST)
})
test('UNKNOWN when no list and nothing matches', () => {
  assert.equal(classifyState({ ...base, frameHasList: false }), STATES.UNKNOWN)
})
