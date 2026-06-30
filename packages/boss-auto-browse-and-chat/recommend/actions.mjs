import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { classifyRejectReason } from './pure/reject-reason-classifier.mjs'
import { waitForState, detectState, STATES } from './page-state.mjs'
import {
  NOT_INTERESTED_REASON_ITEMS_SELECTOR,
  NOT_INTERESTED_REASON_SUBMIT_SELECTOR,
  CARD_GREET_BTN_SELECTOR,
  GREETING_SENT_KNOW_BTN_SELECTOR,
  CONTINUE_CHAT_BUTTON_SELECTOR
} from '../constant.mjs'
import { classifyGreetConfirmation } from './pure/selection.mjs'

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

/** 把已在 DOM 的目标卡滚进视口中部（列表不虚拟化，卡始终可查询）。返回是否找到。 */
export async function scrollCardIntoView (frame, encryptGeekId) {
  if (!frame) return false
  const ok = await frame
    .evaluate((id) => {
      const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
      if (!inner) return false
      inner.scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    }, encryptGeekId)
    .catch(() => false)
  if (ok) await sleep(400)
  return ok
}

/**
 * 在列表卡上直接点"打招呼"（不开简历）。
 * 返回 { greeted, quotaBlocked }：撞 business-block 时 greeted=false, quotaBlocked=true。
 * @param {import('puppeteer').Page} page
 * @param {import('puppeteer').Frame} frame
 * @param {object} cursor
 * @param {string} encryptGeekId
 */
export async function greetFromCard (page, frame, cursor, encryptGeekId) {
  const handle = await frame.evaluateHandle(
    (id, sel) => {
      const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
      if (!inner) return null
      const li = inner.closest('li.card-item')
      return li ? li.querySelector(sel) : null
    },
    encryptGeekId,
    CARD_GREET_BTN_SELECTOR
  )
  const btn = handle.asElement()
  if (!btn) return { greeted: false, quotaBlocked: false }
  await cursor.click(btn).catch(async () => {
    await btn.click().catch(() => {})
  })
  await sleep(800)
  if ((await detectState(page, frame)) === STATES.QUOTA_BLOCKED) {
    return { greeted: false, quotaBlocked: true, confirmation: 'quota-blocked' }
  }

  let knowDialogHandled = false
  const know = await page.waitForSelector(GREETING_SENT_KNOW_BTN_SELECTOR, { timeout: 6000 }).catch(() => null)
  if (know) {
    await cursor.click(know).catch(async () => {
      await know.click().catch(() => {})
    })
    knowDialogHandled = true
    await sleep(500)
  }

  const continueVisible = await frame.evaluate((id, sel) => {
    const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
    if (!inner) return false
    const li = inner.closest('li.card-item')
    return !!li?.querySelector(sel)
  }, encryptGeekId, CONTINUE_CHAT_BUTTON_SELECTOR).catch(() => false)

  const confirmation = classifyGreetConfirmation({
    quotaBlocked: false,
    knowDialogHandled: knowDialogHandled || continueVisible
  })

  return {
    greeted: confirmation === 'confirmed',
    quotaBlocked: false,
    confirmation,
    knowDialogHandled,
    continueVisible
  }
}

// LIVE-SMOKE PENDING: in dev browser, call rejectFromList on one candidate (confirm card disappears,
// reason panel appeared and was dismissed), call scrollGently once (confirm gentle scroll, no scroll-to-bottom).
// Use at most 1–2 actions total.
