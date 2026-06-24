import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { parseQuotaUsage } from './pure/quota-parse.mjs'
import {
  ACCOUNT_RIGHTS_NAV_SELECTOR,
  PRIVILEGE_IFRAME_SELECTOR,
  PRIVILEGE_PANEL_CLOSE_SELECTOR
} from '../constant.mjs'

/**
 * 在 privilege iframe 内按文案锚定抽两行用量。class 全是构建哈希（usingAmount_xxx 等会变），
 * 只认中文 label。锚"叶子节点"（children.length===0，排除同样 trim 后等于 label 的 cardHeader），
 * 再 closest('li') 只读本卡文字，避免依赖嵌套层数。
 *   → li.textContent(折叠空白)="今日查看权益消耗7个/共20个"
 */
function extractQuotaRowsInFrame () {
  const LABELS = ['今日查看权益消耗', '今日沟通权益消耗']
  const leaves = Array.from(document.querySelectorAll('span, p')).filter(
    (el) => el.children.length === 0
  )
  const rows = []
  for (const label of LABELS) {
    const nameEl = leaves.find((el) => el.textContent && el.textContent.trim() === label)
    if (!nameEl) continue
    const card = nameEl.closest('li') || nameEl.parentElement
    const text = (card?.textContent || '').replace(/\s+/g, '')
    const after = text.split(label)[1] || ''
    const usingMatch = after.match(/\d+/)
    const totalMatch = after.match(/共(\d+)/)
    rows.push({
      name: label,
      usingText: usingMatch ? usingMatch[0] : '',
      totalText: totalMatch ? totalMatch[0] : ''
    })
  }
  return rows
}

/** privilege iframe 是异步 SPA：用量两行就绪没？（抽取的前置条件） */
function hasUsageLabelsInFrame () {
  const LABELS = ['今日查看权益消耗', '今日沟通权益消耗']
  return Array.from(document.querySelectorAll('span, p')).some(
    (el) => el.children.length === 0 && el.textContent && LABELS.includes(el.textContent.trim())
  )
}

/**
 * 确保切到"权益使用量"tab。已就绪→true；否则点一次 tab 返回 false。
 * 设计为可被 pollFrame 反复调用：SPA 没渲染好时每轮重点，直到用量行出现。
 */
function ensureUsageTabInFrame () {
  const LABELS = ['今日查看权益消耗', '今日沟通权益消耗']
  const ready = Array.from(document.querySelectorAll('span, p')).some(
    (el) => el.children.length === 0 && el.textContent && LABELS.includes(el.textContent.trim())
  )
  if (ready) return true
  const tab = Array.from(document.querySelectorAll('li, a, span, div, button')).find(
    (el) => el.children.length <= 1 && el.textContent && el.textContent.trim() === '权益使用量'
  )
  if (tab) tab.click()
  return false
}

/** 在 frame 内轮询执行 fn 直到返回真值或超时 */
async function pollFrame (frame, fn, { timeoutMs = 8000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await frame.evaluate(fn).catch(() => false)
    if (ok) return true
    await sleep(intervalMs)
  }
  return false
}

/** 点账号权益入口并等到 privilege iframe 的 contentFrame 可用；拿不到返回 null */
async function openPrivilegeFrame (page) {
  const nav = await page.$(ACCOUNT_RIGHTS_NAV_SELECTOR)
  if (!nav) return null
  await nav.click().catch(() => {})
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const el = await page.$(PRIVILEGE_IFRAME_SELECTOR).catch(() => null)
    if (el) {
      const frame = await el.contentFrame().catch(() => null)
      if (frame) return frame
    }
    await sleep(300)
  }
  return null
}

/**
 * 打开账号权益侧栏 → 等"权益使用量"tab/用量行就绪 → 读真实剩余 → 关侧栏。
 * 失败一律返回 null（调用方回退 cfg 预算，绝不因读不到而中断运行）。
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{view:object|null, greet:object|null}|null>}
 */
export async function readQuota (page) {
  try {
    const frame = await openPrivilegeFrame(page)
    if (!frame) {
      await closePanel(page)
      return null
    }
    // SPA 异步渲染：轮询点 tab 直到用量行出现（而非固定 sleep 一次点击）
    await pollFrame(frame, ensureUsageTabInFrame, { timeoutMs: 8000 })
    const rows = await frame.evaluate(extractQuotaRowsInFrame).catch(() => [])
    await closePanel(page)
    const q = parseQuotaUsage(rows)
    return q.view || q.greet ? q : null
  } catch {
    await closePanel(page).catch(() => {})
    return null
  }
}

/**
 * 诊断版：返回每一步的观测（导航/iframe/tab/用量行/原始行/解析），用于排查 readQuota 返回 null。
 * 与 readQuota 同流程但不提前关闭，且把中间态全吐出来。最后仍会关侧栏。
 * @param {import('puppeteer').Page} page
 */
export async function diagnoseQuota (page) {
  const trail = {
    navFound: false,
    privilegeFrameFound: false,
    tabReady: false,
    labelsPresent: false,
    tabTexts: [],
    rows: [],
    parsed: null
  }
  try {
    const nav = await page.$(ACCOUNT_RIGHTS_NAV_SELECTOR)
    trail.navFound = !!nav
    if (!nav) return trail
    const frame = await openPrivilegeFrame(page)
    trail.privilegeFrameFound = !!frame
    if (!frame) {
      await closePanel(page)
      return trail
    }
    trail.tabReady = await pollFrame(frame, ensureUsageTabInFrame, { timeoutMs: 8000 })
    trail.labelsPresent = await frame.evaluate(hasUsageLabelsInFrame).catch(() => false)
    trail.tabTexts = await frame
      .evaluate(() =>
        Array.from(document.querySelectorAll('li, a, button'))
          .map((e) => (e.textContent || '').trim())
          .filter((t) => t && t.length <= 12)
          .slice(0, 20)
      )
      .catch(() => [])
    trail.rows = await frame.evaluate(extractQuotaRowsInFrame).catch(() => [])
    trail.parsed = parseQuotaUsage(trail.rows)
    await closePanel(page)
    return trail
  } catch (e) {
    await closePanel(page).catch(() => {})
    trail.error = e?.message ?? String(e)
    return trail
  }
}

async function closePanel (page) {
  // 实测：权益侧栏不关会挡住后续所有操作。优先点 privilege iframe 内 b-business-nav-bar 左侧关闭图标，
  // 再兜底外层 .iframe-close，最后 Esc。三重保证关干净。
  try {
    const el = await page.$(PRIVILEGE_IFRAME_SELECTOR).catch(() => null)
    const frame = el ? await el.contentFrame().catch(() => null) : null
    if (frame) {
      const clicked = await frame
        .evaluate(() => {
          const icon = document.querySelector('.b-business-nav-bar__left-wrap i')
          if (icon) {
            icon.click()
            return true
          }
          return false
        })
        .catch(() => false)
      if (clicked) await sleep(400)
    }
  } catch {
    // ignore，走兜底
  }
  const btn = await page.$(PRIVILEGE_PANEL_CLOSE_SELECTOR).catch(() => null)
  if (btn) await btn.click().catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(400)
}
