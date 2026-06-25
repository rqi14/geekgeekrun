import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { waitForState, STATES } from './page-state.mjs'
import { extractResumeText } from '../resume-extractor.mjs'
import { filterFontTestLines } from './pure/resume-text.mjs'
import {
  RESUME_MODAL_SELECTOR,
  RESUME_GREET_BTN_SELECTOR,
  RESUME_GREET_DONE_SELECTOR,
  RESUME_SUMMARY_SELECTOR,
  RESUME_MODAL_CLOSE_SELECTOR
} from '../constant.mjs'

/**
 * 点击某卡片打开简历弹窗。返回是否成功进入 RESUME_MODAL。
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 * @param {string} encryptGeekId
 * @returns {Promise<boolean>}
 */
export async function openResume (page, frame, cursor, encryptGeekId) {
  const sel = `div.card-inner[data-geek="${encryptGeekId}"]`
  const handle = await frame.$(sel)
  if (!handle) return false
  await handle.hover().catch(() => {})
  await cursor.click(handle).catch(async () => {
    await handle.click().catch(() => {})
  })
  return waitForState(page, frame, STATES.RESUME_MODAL, { timeoutMs: 8000 })
}

/**
 * 校验当前简历弹窗就是目标候选人（弹窗有 prev/next，可能残留）。用概览文本里的姓名兜底。
 * Override C: 拿不到名字时返回 true（不阻断），靠后续验证。
 * @param {import('puppeteer').Frame} frame
 * @param {string} expectedName
 * @returns {Promise<boolean>}
 */
export async function assertIdentity (frame, expectedName) {
  const name = await frame
    .$eval(
      `${RESUME_MODAL_SELECTOR} .name, ${RESUME_MODAL_SELECTOR} .geek-name`,
      (el) => el.textContent.trim()
    )
    .catch(() => null)
  if (!name || !expectedName) return true // 拿不到名字时不阻断，靠后续验证
  return name.includes(expectedName) || expectedName.includes(name)
}

/**
 * 读取简历弹窗内的"经历概览"文本。
 * @param {import('puppeteer').Frame} frame
 * @returns {Promise<{summary: string}>}
 */
export async function readSummary (frame) {
  const summary = await frame
    .$eval(RESUME_SUMMARY_SELECTOR, (el) => el.innerText.trim())
    .catch(() => '')
  return { summary }
}

/**
 * 在简历弹窗内点"打招呼"，等"继续沟通"出现确认成功。
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 * @returns {Promise<boolean>}
 */
export async function greetInModal (frame, cursor) {
  const btn = await frame.$(RESUME_GREET_BTN_SELECTOR)
  if (!btn) return false
  await cursor.click(btn).catch(async () => {
    await btn.click().catch(() => {})
  })
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const done = await frame.$(RESUME_GREET_DONE_SELECTOR).catch(() => null)
    if (done) return true
    await sleep(300)
  }
  return false
}

/**
 * 关闭简历弹窗，等待回到 LIST 状态。
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 */
export async function closeResume (page, frame, cursor) {
  const btn = await frame.$(RESUME_MODAL_CLOSE_SELECTOR)
  if (btn) {
    await cursor.click(btn).catch(async () => {
      await btn.click().catch(() => {})
    })
  }
  await waitForState(page, frame, STATES.LIST, { timeoutMs: 5000 })
}

// LIVE-SMOKE PENDING: in dev browser, call openResume (confirm returns true),
// readSummary (confirm non-empty summary), greetInModal (confirm 继续沟通 / btn-outline-v2 detected),
// closeResume (confirm returns to LIST). Use at most 1–2 candidates.

/**
 * 等 canvas 渲染稳定后抓取在线简历全文（嵌套 iframe 的 #resume，靠 fillText 钩子跨 frame 汇总到主页面）。
 * 需传入 setupCanvasTextHook 返回的句柄 canvasHook。canvas 为空/无句柄时返回 ''（调用方降级用 .resume-summary）。
 * @param {import('puppeteer').Page} page
 * @param {{getCapturedText?:Function, peekCapturedText?:Function}} canvasHook
 * @param {{timeoutMs?:number, intervalMs?:number, stableNeeded?:number}} [opts]
 * @returns {Promise<string>}
 */
export async function captureResumeText (page, canvasHook, { timeoutMs = 9000, intervalMs = 400, stableNeeded = 3 } = {}) {
  if (!canvasHook?.getCapturedText) return ''
  const deadline = Date.now() + timeoutMs
  let last = -1
  let stable = 0
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const n = canvasHook.peekCapturedText ? await canvasHook.peekCapturedText(page).catch(() => 0) : 0
    if (n > 0 && n === last) {
      if (++stable >= stableNeeded) break
    } else {
      stable = n > 0 ? 1 : 0
    }
    last = n
  }
  const captured = await canvasHook.getCapturedText(page).catch(() => [])
  if (!captured.length) return ''
  return filterFontTestLines(extractResumeText(captured)).join('\n')
}
