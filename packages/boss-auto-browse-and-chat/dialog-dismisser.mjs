/**
 * 通用弹窗 / 遮挡层自动识别与关闭。
 *
 * 设计目标：减少手动维护「治理公告」「意向沟通」之类一次性弹窗 selector 的成本。
 * 思路：
 * 1) 启发式扫描页面顶层 fixed / 高 z-index 浮层；
 * 2) 在浮层内按文本（我已知晓/我知道了/知道了/确定/好的/关闭/取消/跳过/×）+
 *    aria-label / class（close|dismiss|confirm-btn|btn-sure）匹配关闭按钮；
 * 3) safeClickAt：点击前用 elementFromPoint 检测目标坐标是否被遮挡，被挡则先尝试关闭遮挡再重试。
 *
 * 注意：所有浏览器侧逻辑都在一次 evaluate 内做完，避免多次 round-trip；返回结果含被关闭浮层的 outerHTML 摘要供日志审计。
 */

import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { debug as logDebug, info as logInfo } from './logger.mjs'

/** 关闭按钮文本（按优先级） */
const CLOSE_TEXTS = [
  '我已知晓', '我知道啦', '我知道了', '知道了', '我知道',
  '好的', '确定', '确认',
  '关闭', '取消',
  '跳过', '稍后再说', '稍后', '不再提示',
  '我已阅读并同意', '同意并继续'
]

/** 单字关闭符号 */
const CLOSE_GLYPHS = ['×', '✕', '✖', '⨯', '╳']

/**
 * 浏览器侧的弹窗识别 / 关闭脚本。
 * 一次 evaluate 内完成扫描 + 点击，避免多次 round-trip。
 *
 * @returns {{
 *   dismissed: boolean,
 *   reason?: 'TEXT' | 'CLASS' | 'ARIA' | 'GLYPH',
 *   text?: string,
 *   outerHtml?: string,
 *   overlaySignature?: string
 * }}
 */
function dismissInPageBody (closeTexts, closeGlyphs) {
  const isVisible = (el) => {
    if (!el || !el.getBoundingClientRect) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }

  const vw = window.innerWidth
  const vh = window.innerHeight

  // 1) 扫描所有 fixed/absolute 大面积浮层 —— 弹窗几乎都长这样
  const overlays = []
  const all = document.body ? document.body.querySelectorAll('*') : []
  for (const el of all) {
    if (!isVisible(el)) continue
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue
    const r = el.getBoundingClientRect()
    // 至少占视口 5%（小通知不算 block，跳过）
    const area = r.width * r.height
    if (area < vw * vh * 0.05) continue
    // 不是中央 / 顶部覆盖的也跳过（侧边栏 etc）
    if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh) continue
    const z = parseInt(cs.zIndex || '0', 10) || 0
    const cls = (el.className && typeof el.className === 'string') ? el.className : (el.getAttribute && el.getAttribute('class')) || ''
    const looksLikeDialog = /dialog|popup|modal|mask|overlay|drawer/i.test(cls)
    if (z < 100 && !looksLikeDialog) continue
    // 排除：业务流程主动打开、不该被自动关闭的 dialog（在线/附件简历预览、索取简历确认）
    if (/resume-common-dialog|ask-for-resume-confirm|c-resume/i.test(cls)) continue
    overlays.push({ el, z, area, looksLikeDialog })
  }

  // 优先级：明显是 dialog 的 + z-index 高 + 面积大
  overlays.sort((a, b) => {
    if (a.looksLikeDialog !== b.looksLikeDialog) return a.looksLikeDialog ? -1 : 1
    if (b.z !== a.z) return b.z - a.z
    return b.area - a.area
  })

  const findClose = (root) => {
    const candidates = root.querySelectorAll('button, [role="button"], a, span, div, i')
    let best = null
    for (const c of candidates) {
      if (!isVisible(c)) continue
      // 只考虑可点击 / 有 cursor pointer 的元素
      const cs = getComputedStyle(c)
      const looksClickable = c.tagName === 'BUTTON' || c.getAttribute('role') === 'button' ||
        cs.cursor === 'pointer' ||
        /btn|button|close|confirm|sure|know|agree/i.test(c.className || '')
      if (!looksClickable) continue
      const text = (c.innerText || c.textContent || '').trim()
      const aria = (c.getAttribute('aria-label') || '') + ' ' + (c.getAttribute('title') || '')
      const cls = c.className || ''

      // 1) 文本严格匹配（短文本，整段就是按钮文案）
      if (text.length > 0 && text.length <= 12) {
        for (const t of closeTexts) {
          if (text === t || text.includes(t)) {
            return { btn: c, reason: 'TEXT', text }
          }
        }
        for (const g of closeGlyphs) {
          if (text === g) return { btn: c, reason: 'GLYPH', text }
        }
      }
      // 2) class / aria 匹配关闭语义
      if (/close|dismiss|confirm-btn|btn-sure/i.test(cls)) {
        if (!best) best = { btn: c, reason: 'CLASS', text: text.slice(0, 30) }
      }
      if (/close|dismiss/i.test(aria)) {
        if (!best) best = { btn: c, reason: 'ARIA', text: aria.trim().slice(0, 30) }
      }
    }
    return best
  }

  for (const ov of overlays) {
    const hit = findClose(ov.el)
    if (!hit) continue
    const r = hit.btn.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    // 触发真实 click（HTMLElement.click() 同时通知 Vue/React 监听）
    try {
      hit.btn.click()
    } catch (_) {
      // ignore
    }
    const outerHtml = (ov.el.outerHTML || '').slice(0, 400)
    const sigParts = []
    if (ov.el.id) sigParts.push('#' + ov.el.id)
    if (ov.el.className) sigParts.push('.' + String(ov.el.className).split(/\s+/).slice(0, 2).join('.'))
    return {
      dismissed: true,
      reason: hit.reason,
      text: hit.text,
      outerHtml,
      overlaySignature: sigParts.join('') || ov.el.tagName.toLowerCase()
    }
  }
  return { dismissed: false }
}

/**
 * 在 page / frame 上扫描并关闭一个挡住操作的浮层。
 * 调用方可循环调用直到 false（最多 N 次）以处理叠加弹窗。
 * @param {import('puppeteer').Page | import('puppeteer').Frame} ctx
 * @returns {Promise<{dismissed: boolean, reason?: string, text?: string, overlaySignature?: string, outerHtml?: string}>}
 */
export async function tryDismissOneOverlay (ctx) {
  try {
    const result = await ctx.evaluate(dismissInPageBody, CLOSE_TEXTS, CLOSE_GLYPHS)
    if (result?.dismissed) {
      logInfo('[dialog-dismisser] 自动关闭浮层：', result.overlaySignature, '匹配=', result.reason, '文案=', result.text)
      logDebug('[dialog-dismisser] outerHTML 摘要：', result.outerHtml)
    }
    return result || { dismissed: false }
  } catch (e) {
    logDebug('[dialog-dismisser] evaluate 失败:', e?.message)
    return { dismissed: false }
  }
}

/**
 * 多次循环尝试关闭浮层（应对叠加 / 关一个出一个的情况）。
 * @param {import('puppeteer').Page | import('puppeteer').Frame} ctx
 * @param {{ maxRounds?: number, gapMs?: number }} [opts]
 * @returns {Promise<number>} 关闭的浮层数量
 */
export async function dismissBlockingOverlays (ctx, opts = {}) {
  const maxRounds = opts.maxRounds ?? 3
  const gapMs = opts.gapMs ?? 350
  let count = 0
  for (let i = 0; i < maxRounds; i++) {
    const r = await tryDismissOneOverlay(ctx)
    if (!r.dismissed) break
    count++
    await sleep(gapMs)
  }
  return count
}

/**
 * 检查 (x, y) 视口坐标处的最顶层元素是否是 expectedEl 或其后代。
 * 若不是，说明被遮挡。返回遮挡元素的简要描述用于日志。
 *
 * 注意 (x,y) 必须是 viewport 坐标（page-relative），调用方可通过
 * boundingBox() 拿到的就是 page-relative，配合 page.evaluate 内部用 elementFromPoint 即可。
 *
 * @param {import('puppeteer').Page | import('puppeteer').Frame} ctx
 * @param {import('puppeteer').ElementHandle} expectedEl
 * @param {number} x
 * @param {number} y
 * @returns {Promise<{blocked: boolean, topTag?: string, topClass?: string}>}
 */
export async function checkBlockedAt (ctx, expectedEl, x, y) {
  try {
    const result = await ctx.evaluate((targetEl, px, py) => {
      const top = document.elementFromPoint(px, py)
      if (!top) return { blocked: false }
      // 只有 top === target 或 top 是 target 的后代时才认为未被遮挡。
      // top 是 target 的祖先意味着 target 上方有元素拦截了点击事件（pointer-events 转发到祖先）。
      if (top === targetEl || (targetEl && targetEl.contains && targetEl.contains(top))) {
        return { blocked: false }
      }
      return {
        blocked: true,
        topTag: top.tagName?.toLowerCase(),
        topClass: (typeof top.className === 'string' ? top.className : '').slice(0, 60)
      }
    }, expectedEl, x, y)
    return result || { blocked: false }
  } catch (_) {
    return { blocked: false }
  }
}

/**
 * 安全点击：先校验目标是否被遮挡，被挡则尝试关闭浮层后重试。
 *
 * 兼容 humanMouse 的 cursor.click({x, y})。当 ctx 是 Frame，elementFromPoint
 * 是 frame 内部坐标系，但 boundingBox() 是 page 坐标——所以这里 ctx 应当与 expectedEl
 * 来自同一上下文（Frame 元素就传 Frame，主页面元素就传 Page）。
 *
 * @param {{
 *   ctx: import('puppeteer').Page | import('puppeteer').Frame,
 *   page: import('puppeteer').Page,
 *   element: import('puppeteer').ElementHandle,
 *   cursor: { click: (p:{x:number,y:number}) => Promise<void> },
 *   maxRetries?: number,
 *   logPrefix?: string
 * }} args
 * @returns {Promise<{ clicked: boolean, dismissedCount: number }>}
 */
export async function safeClickElement (args) {
  const { ctx, page, element, cursor, maxRetries = 3, logPrefix = '[safe-click]' } = args
  let dismissedCount = 0
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const box = await element.boundingBox().catch(() => null)
    if (!box) {
      logDebug(logPrefix, '元素无 boundingBox，回退到 element.click()')
      await element.click().catch(() => {})
      return { clicked: true, dismissedCount }
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // ctx 上的 elementFromPoint 用的是 ctx 自己的 viewport 坐标
    // 当 ctx 是 page，box 已是 page-relative，可直接用
    // 当 ctx 是 frame，box 是 page 坐标但 frame elementFromPoint 期待 frame 坐标
    // —— 此处保守：仅当 ctx === page 时执行遮挡检测（iframe 内一般无遮挡，主页面才有全局弹窗）
    const sameAsPage = ctx === page
    let blocked = { blocked: false }
    if (sameAsPage) {
      blocked = await checkBlockedAt(ctx, element, cx, cy)
    }

    if (blocked.blocked) {
      logInfo(logPrefix, `点击目标被遮挡（top=${blocked.topTag}.${blocked.topClass}），尝试自动关闭浮层…`)
      const n = await dismissBlockingOverlays(page)
      dismissedCount += n
      if (n === 0) {
        logDebug(logPrefix, '未识别到可关闭的浮层，强制点击一次后返回')
        await cursor.click({ x: cx, y: cy }).catch(() => {})
        return { clicked: true, dismissedCount }
      }
      // 关闭后重试
      continue
    }
    await cursor.click({ x: cx, y: cy })
    return { clicked: true, dismissedCount }
  }
  // 重试用尽，最后兜底直接点
  const box = await element.boundingBox().catch(() => null)
  if (box) {
    await cursor.click({ x: box.x + box.width / 2, y: box.y + box.height / 2 }).catch(() => {})
  }
  return { clicked: true, dismissedCount }
}
