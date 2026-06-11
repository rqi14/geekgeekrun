import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { fuzzyReason } from './pure/reason-matcher.mjs'
import { waitForState, STATES } from './page-state.mjs'
import {
  NOT_INTERESTED_REASON_ITEMS_SELECTOR,
  NOT_INTERESTED_REASON_FALLBACK
} from '../constant.mjs'

/**
 * 从列表对某候选人点 X 并选原因。等待原因选择、选好后等待回到 LIST。
 * Override B: 用 evaluateHandle 在候选人自己的 li.card-item 内定位 X 按钮，
 * 避免 puppeteer xpath 兼容性问题。
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 * @param {string} encryptGeekId
 * @param {string} internalReason
 * @returns {Promise<boolean>}
 */
export async function rejectFromList (page, frame, cursor, encryptGeekId, internalReason) {
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
  const wanted = fuzzyReason(internalReason, options, NOT_INTERESTED_REASON_FALLBACK)
  const items = await frame.$$(NOT_INTERESTED_REASON_ITEMS_SELECTOR)
  for (let i = 0; i < items.length; i++) {
    if (options[i] === wanted) {
      await cursor.click(items[i]).catch(async () => {
        await items[i].click().catch(() => {})
      })
      break
    }
  }
  return waitForState(page, frame, STATES.LIST, { timeoutMs: 4000 })
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
