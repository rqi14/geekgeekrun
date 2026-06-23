import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { classifyRejectReason } from './pure/reject-reason-classifier.mjs'
import { waitForState, STATES } from './page-state.mjs'
import {
  NOT_INTERESTED_REASON_ITEMS_SELECTOR,
  NOT_INTERESTED_REASON_SUBMIT_SELECTOR
} from '../constant.mjs'

/**
 * 从列表对某候选人点 X 并选原因。等待原因选择、选好后等待回到 LIST。
 * Override B: 用 evaluateHandle 在候选人自己的 li.card-item 内定位 X 按钮，
 * 避免 puppeteer xpath 兼容性问题。
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 * @param {string} encryptGeekId
 * @param {string} internalReason - 兜底/日志用；真正选项由 candidate 自动分类决定
 * @param {object} [candidate] - 候选人卡片数据（用于按真实属性自动分类原因）
 * @returns {Promise<boolean>}
 */
export async function rejectFromList (page, frame, cursor, encryptGeekId, internalReason, candidate = {}) {
  const xHandle = await frame.evaluateHandle((id) => {
    const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
    if (!inner) return null
    const li = inner.closest('li.card-item')
    return li ? li.querySelector('div.tooltip-wrap.suitable') : null
  }, encryptGeekId)
  const x = xHandle.asElement()
  if (!x) return false
  await cursor.click(x).catch(async () => {
    await x.click().catch(() => {})
  })
  if (!(await waitForState(page, frame, STATES.LIST_REASON_PANEL, { timeoutMs: 4000 }))) return false
  const options = await frame.$$eval(NOT_INTERESTED_REASON_ITEMS_SELECTOR, (els) =>
    els.map((e) => e.textContent.trim())
  )
  // 自动分类：按候选人真实属性在动态选项里挑最贴切的具体原因，避开需填输入框的「其他原因」。
  const { reason: wanted } = classifyRejectReason(candidate, options)
  const fallback = options.find((o) => !/其他/.test(o)) ?? options[0]
  const target = wanted ?? fallback
  const items = await frame.$$(NOT_INTERESTED_REASON_ITEMS_SELECTOR)
  for (let i = 0; i < items.length; i++) {
    if (options[i] === target) {
      await cursor.click(items[i]).catch(async () => {
        await items[i].click().catch(() => {})
      })
      break
    }
  }
  // 选具体原因通常即时生效并关闭弹窗；个别情况需点「提交」，作兜底（有则点，无忽略）。
  await sleep(300)
  const submitBtn = await frame.$(NOT_INTERESTED_REASON_SUBMIT_SELECTOR).catch(() => null)
  if (submitBtn) {
    await cursor.click(submitBtn).catch(async () => {
      await submitBtn.click().catch(() => {})
    })
  }
  return waitForState(page, frame, STATES.LIST, { timeoutMs: 5000 })
}

/**
 * 受硬上限约束的温和滚屏（一次调用 = 一"步"）。绝不一次滚到底。
 * 这是唯一允许滚动的函数。
 * @param {import('puppeteer').Page} page
 * @param {{scrollDelayMsRange?: [number, number]}} [cfg]
 */
export async function scrollGently (page, cfg) {
  const [lo, hi] = cfg?.scrollDelayMsRange ?? [800, 2000]
  for (let s = 0; s < 4; s++) {
    await page.mouse.wheel({ deltaY: 120 + Math.floor(60 * Math.random()) })
    await sleep(120 + Math.floor(120 * Math.random()))
  }
  await sleepWithRandomDelay(lo, hi)
}

// LIVE-SMOKE PENDING: in dev browser, call rejectFromList on one candidate (confirm card disappears,
// reason panel appeared and was dismissed), call scrollGently once (confirm gentle scroll, no scroll-to-bottom).
// Use at most 1–2 actions total.
