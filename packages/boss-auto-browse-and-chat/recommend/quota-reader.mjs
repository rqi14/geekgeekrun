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

/**
 * 打开账号权益侧栏 → 权益使用量 → 读真实剩余 → 关侧栏。
 * 失败一律返回 null（调用方回退 cfg 预算，绝不因读不到而中断运行）。
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{view:object|null, greet:object|null}|null>}
 */
export async function readQuota (page) {
  try {
    const nav = await page.$(ACCOUNT_RIGHTS_NAV_SELECTOR)
    if (!nav) return null
    await nav.click().catch(() => {})
    let frame = null
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const el = await page.$(PRIVILEGE_IFRAME_SELECTOR).catch(() => null)
      if (el) {
        frame = await el.contentFrame().catch(() => null)
        if (frame) break
      }
      await sleep(300)
    }
    if (!frame) {
      await closePanel(page)
      return null
    }
    await frame
      .evaluate(() => {
        const tab = Array.from(document.querySelectorAll('li, a, span, div')).find(
          (el) => el.textContent && el.textContent.trim() === '权益使用量'
        )
        if (tab) tab.click()
      })
      .catch(() => {})
    await sleep(800)
    const rows = await frame.evaluate(extractQuotaRowsInFrame).catch(() => [])
    await closePanel(page)
    const q = parseQuotaUsage(rows)
    return q.view || q.greet ? q : null
  } catch {
    await closePanel(page).catch(() => {})
    return null
  }
}

async function closePanel (page) {
  const btn = await page.$(PRIVILEGE_PANEL_CLOSE_SELECTOR).catch(() => null)
  if (btn) await btn.click().catch(() => {})
  await sleep(400)
}
