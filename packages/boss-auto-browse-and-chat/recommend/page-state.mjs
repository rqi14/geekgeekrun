import { classifyState, STATES } from './pure/state-classifier.mjs'
import { detectRiskControl } from '../risk-detector.mjs'
import {
  CANDIDATE_LIST_SELECTOR,
  RESUME_MODAL_CLOSE_SELECTOR,
  NOT_INTERESTED_REASON_POPUP_CLOSE_SELECTOR
} from '../constant.mjs'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

/** 在一个上下文里收集可见浮层的 className 列表（自包含，注入用） */
function collectOverlayClassesInPage () {
  const SEL =
    '[class*="dialog"],[class*="popup"],[class*="reason"],[class*="card-reason"],[class*="feedback"],[class*="uninstall-extension"]'
  const out = []
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const cn = typeof el.className === 'string' ? el.className : ''
    if (!cn) continue
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    if (r.width > 2 && r.height > 2 && st.display !== 'none' && st.visibility !== 'hidden') out.push(cn)
  }
  return out
}

export async function gatherSignals (page, frame) {
  const verify = await detectRiskControl(page).catch(() => false)
  const mainText = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
  const mainOverlayClasses = await page.evaluate(collectOverlayClassesInPage).catch(() => [])
  let frameOverlayClasses = []
  let frameHasList = false
  if (frame) {
    frameOverlayClasses = await frame.evaluate(collectOverlayClassesInPage).catch(() => [])
    frameHasList = await frame
      .evaluate((sel) => !!document.querySelector(sel), CANDIDATE_LIST_SELECTOR)
      .catch(() => false)
  }
  return { mainText, mainOverlayClasses, frameOverlayClasses, frameHasList, verify }
}

export async function detectState (page, frame) {
  return classifyState(await gatherSignals(page, frame))
}

export async function waitForState (page, frame, target, { timeoutMs = 8000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await detectState(page, frame)) === target) return true
    await sleep(intervalMs)
  }
  return false
}

/**
 * 把残留弹窗关回 LIST。返回处理后的状态。绝不处理 ACCOUNT_BANNED（交给调用方中止）。
 * Override A: dismissGovernanceNoticeDialog 用动态 import 避免顶层循环依赖。
 */
export async function selfHeal (page, frame) {
  const st = await detectState(page, frame)
  if (st === STATES.GOVERNANCE_NOTICE) {
    // LIVE-SMOKE PENDING: verify dismissGovernanceNoticeDialog resolves in the real browser after lazy import
    const { dismissGovernanceNoticeDialog } = await import('../index.mjs')
    await dismissGovernanceNoticeDialog(page).catch(() => {})
    return
  }
  if (st === STATES.RESUME_MODAL && frame) {
    await frame.$eval(RESUME_MODAL_CLOSE_SELECTOR, (el) => el.click()).catch(() => {})
    return
  }
  if (st === STATES.LIST_REASON_PANEL && frame) {
    await frame.$eval(NOT_INTERESTED_REASON_POPUP_CLOSE_SELECTOR, (el) => el.click()).catch(() => {})
    return
  }
  if (st === STATES.RESUME_REJECT_DIALOG) {
    await page.$eval('div.dialog-wrap.active .boss-popup__close', (el) => el.click()).catch(() => {})
    return
  }
}

export { STATES }
