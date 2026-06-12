/**
 * dev/capture-recommend.mjs — 推荐牛人页「人工操作 + 快照捕获」探查工具（非功能实现，仅用于摸清真实页面）
 *
 * 用法（在 packages/boss-auto-browse-and-chat 目录下）：
 *   node dev/capture-recommend.mjs
 *
 * 复用项目现有 stealth 启动 + 已存 BOSS 登录（boss-cookies / boss-local-storage / 可选持久化 profile）。
 * 启动一个【可见】浏览器并停在推荐牛人页；你手动点卡片 / 触发弹窗 / 点不感兴趣……
 * 每到一个想让我看的状态，在【终端】输入一个标签后回车（直接回车也行），脚本会把当前状态 dump 成一组快照文件：
 *
 *   dev/snapshots/<seq>-<label>/
 *     screenshot.png       视口截图（可直接肉眼/AI 查看当前布局）
 *     iframe.html          recommendFrame 内 body 的清洗后 HTML（去脚本/样式、截断超长属性、canvas 占位）
 *     main-overlays.html   主页面上的浮层（dialog/popup/reason/toast/mask）清洗后 HTML 拼接
 *     meta.json            URL、视口尺寸、每张卡片的坐标 + 是否在 iframe 视口内、检测到的浮层列表
 *
 * 终端命令：
 *   <文本> + 回车   以该文本为标签抓一张快照（例：clicked-card / reason-popup / after-greet）
 *   回车（空）       以 snapshot 为默认标签抓一张
 *   full + 回车      抓一张「整页 iframe body」的快照（HTML 更全，文件更大）
 *   q + 回车         退出并关闭浏览器
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { setDomainLocalStorage } from '@geekgeekrun/utils/puppeteer/local-storage.mjs'
import { buildRecruiterLaunchOptions } from '../launch-options.mjs'
import { readStorageFile, writeStorageFile, readConfigFile, ensureConfigFileExist, ensureStorageFileExist } from '../runtime-file-utils.mjs'
import { BOSS_RECOMMEND_PAGE_URL } from '../constant.mjs'
import { initPuppeteer, dismissGovernanceNoticeDialog } from '../index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SNAP_ROOT = path.join(__dirname, 'snapshots')
const localStoragePageUrl = 'https://www.zhipin.com/desktop/'

ensureConfigFileExist()
ensureStorageFileExist()
fs.mkdirSync(SNAP_ROOT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[capture]', ...a)

/** 把当前 page 的 cookie + localStorage 回存到本地（登录后调用，使下次免登录） */
async function storeStorage (page) {
  try {
    const [cookies, localStorage] = await Promise.all([
      page.cookies(),
      page.evaluate(() => JSON.stringify(window.localStorage)).then((s) => JSON.parse(s)).catch(() => ({}))
    ])
    await Promise.all([
      writeStorageFile('boss-cookies.json', cookies),
      writeStorageFile('boss-local-storage.json', localStorage)
    ])
    log('已回存登录信息（cookies + localStorage）')
  } catch (e) {
    log('回存登录信息失败:', e.message)
  }
}

/**
 * 在页面/Frame 上下文里把一个节点克隆并清洗后返回 outerHTML。
 * 去掉 script/style/noscript，canvas/img 的大数据替换为占位，超长属性截断。
 * 这个函数会被序列化注入到 evaluate，不能引用外部变量。
 */
function cleanOuterHTMLInPage (rootSelector) {
  const root = rootSelector ? document.querySelector(rootSelector) : document.body
  if (!root) return ''
  const clone = root.cloneNode(true)
  const ATTR_MAX = 200
  const walk = (node) => {
    if (node.nodeType !== 1) return
    const tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'script' || tag === 'style' || tag === 'noscript') {
      node.remove()
      return
    }
    if (tag === 'canvas') {
      node.replaceWith(document.createComment(' canvas (' + (node.getAttribute('width') || '?') + 'x' + (node.getAttribute('height') || '?') + ') '))
      return
    }
    if (node.attributes) {
      for (const attr of Array.from(node.attributes)) {
        let v = attr.value || ''
        if (attr.name === 'src' || attr.name === 'style' || attr.name === 'href') {
          if (v.startsWith('data:') || v.length > ATTR_MAX) {
            node.setAttribute(attr.name, v.slice(0, 40) + '…[truncated ' + v.length + ']')
          }
        } else if (v.length > ATTR_MAX) {
          node.setAttribute(attr.name, v.slice(0, ATTR_MAX) + '…[truncated]')
        }
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  walk(clone)
  return clone.outerHTML
}

/**
 * 收集主页面/Frame 上检测到的浮层（dialog/popup/reason/toast/mask 等），返回 [{selectorHint, rect, html}]。
 * 仅收集可见（display!=none、有面积）的元素，并去掉被其它收集项包含的子项。
 */
function collectOverlaysInPage () {
  const SELECTOR = [
    '[class*="dialog"]', '[class*="popup"]', '[class*="reason"]',
    '[class*="toast"]', '[class*="mask"]', '.boss-popup__wrapper',
    '[class*="tooltip"]', '[class*="card-reason"]'
  ].join(',')
  const ATTR_MAX = 200
  const cleanNode = (root) => {
    const clone = root.cloneNode(true)
    const walk = (node) => {
      if (node.nodeType !== 1) return
      const tag = node.tagName ? node.tagName.toLowerCase() : ''
      if (tag === 'script' || tag === 'style' || tag === 'noscript') { node.remove(); return }
      if (tag === 'canvas') { node.replaceWith(document.createComment(' canvas ')); return }
      if (node.attributes) {
        for (const attr of Array.from(node.attributes)) {
          const v = attr.value || ''
          if (v.startsWith('data:') || v.length > ATTR_MAX) {
            node.setAttribute(attr.name, v.slice(0, 40) + '…[truncated ' + v.length + ']')
          }
        }
      }
      for (const c of Array.from(node.childNodes)) walk(c)
    }
    walk(clone)
    return clone.outerHTML
  }
  const all = Array.from(document.querySelectorAll(SELECTOR))
  const visible = all.filter((el) => {
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.01
  })
  // 去重：丢掉被另一个 visible 元素包含的子元素，保留最外层
  const outer = visible.filter((el) => !visible.some((other) => other !== el && other.contains(el)))
  return outer.map((el) => {
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className : '',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      html: cleanNode(el)
    }
  })
}

/** 收集 iframe 内卡片列表的几何信息 + 是否在 iframe 视口内 */
function collectCardsInFrame () {
  const scroller = document.scrollingElement || document.documentElement
  const vh = scroller ? scroller.clientHeight : window.innerHeight
  const items = Array.from(document.querySelectorAll('ul.card-list > li.card-item'))
  return {
    viewport: { w: window.innerWidth, h: vh, scrollTop: scroller ? scroller.scrollTop : 0 },
    count: items.length,
    cards: items.map((li, idx) => {
      const r = li.getBoundingClientRect()
      const nameEl = li.querySelector('span.name')
      const cardInner = li.querySelector('div.card-inner')
      const inViewport = r.top >= 0 && r.bottom <= vh
      const partiallyVisible = r.bottom > 0 && r.top < vh
      return {
        index: idx,
        name: nameEl ? nameEl.textContent.trim() : '',
        geekId: cardInner ? (cardInner.getAttribute('data-geek') || cardInner.getAttribute('data-geekid') || '') : '',
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport,
        partiallyVisible
      }
    })
  }
}

/**
 * 在 page/frame 上下文里读取一个轻量「状态指纹」：卡片数、滚动档位、可见浮层的首类名、是否有 active 简历弹窗。
 * 给 Node 侧轮询比对用 —— 状态一变且稳定下来就自动抓一张，不依赖往 iframe 注入回调（exposeFunction 跨 frame 不可靠）。
 * 自包含、不引用外部变量（会被序列化注入）。
 */
function readStateInPage () {
  const SELECTOR = [
    '[class*="dialog"]', '[class*="popup"]', '[class*="reason"]',
    '[class*="toast"]', '[class*="mask"]', '[class*="tooltip"]', '[class*="card-reason"]'
  ].join(',')
  const out = { cards: 0, scroll: 0, dialogActive: false, overlays: [] }
  out.cards = document.querySelectorAll('ul.card-list > li.card-item').length
  const sc = document.scrollingElement || document.documentElement
  out.scroll = sc ? Math.round(sc.scrollTop / 120) : 0
  const seen = {}
  for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
    const cn = typeof el.className === 'string' ? el.className : ''
    if (!cn) continue
    if (/dialog-wrap/.test(cn) && /active/.test(cn)) out.dialogActive = true
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    if (r.width > 2 && r.height > 2 && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.01) {
      const key = cn.split(/\s+/)[0]
      if (key && !seen[key]) { seen[key] = 1; out.overlays.push(key) }
    }
  }
  out.overlays.sort()
  return out
}

let seq = 0

async function captureSnapshot (page, getFrame, label, full) {
  seq += 1
  const safeLabel = (label || 'snapshot').replace(/[^\w.-]+/g, '_').slice(0, 40)
  const dirName = String(seq).padStart(3, '0') + '-' + safeLabel
  const dir = path.join(SNAP_ROOT, dirName)
  fs.mkdirSync(dir, { recursive: true })

  const frame = getFrame()
  const meta = { seq, label: safeLabel, ts: new Date().toISOString(), mainUrl: page.url(), full: !!full }

  // 截图（视口）
  try {
    await page.screenshot({ path: path.join(dir, 'screenshot.png') })
  } catch (e) {
    meta.screenshotError = e.message
  }

  // iframe HTML + 卡片几何
  if (frame) {
    try {
      const html = await frame.evaluate(cleanOuterHTMLInPage, full ? 'body' : 'ul.card-list')
      fs.writeFileSync(path.join(dir, 'iframe.html'), html || '(empty)')
    } catch (e) {
      meta.iframeHtmlError = e.message
    }
    try {
      meta.frame = await frame.evaluate(collectCardsInFrame)
    } catch (e) {
      meta.frameError = e.message
    }
    try {
      const frameOverlays = await frame.evaluate(collectOverlaysInPage)
      if (frameOverlays && frameOverlays.length) {
        fs.writeFileSync(path.join(dir, 'iframe-overlays.html'),
          frameOverlays.map((o) => `<!-- ${o.tag}.${o.className} @ ${JSON.stringify(o.rect)} -->\n${o.html}`).join('\n\n'))
        meta.frameOverlays = frameOverlays.map((o) => ({ tag: o.tag, className: o.className, rect: o.rect }))
      }
    } catch (e) {
      meta.frameOverlayError = e.message
    }
  } else {
    meta.frameMissing = true
  }

  // 主页面浮层
  try {
    const overlays = await page.evaluate(collectOverlaysInPage)
    fs.writeFileSync(path.join(dir, 'main-overlays.html'),
      (overlays || []).map((o) => `<!-- ${o.tag}.${o.className} @ ${JSON.stringify(o.rect)} -->\n${o.html}`).join('\n\n') || '(none)')
    meta.mainOverlays = (overlays || []).map((o) => ({ tag: o.tag, className: o.className, rect: o.rect }))
  } catch (e) {
    meta.mainOverlayError = e.message
  }

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  const overlayTotal = (meta.mainOverlays?.length || 0) + (meta.frameOverlays?.length || 0)
  const overlayNote = overlayTotal ? ` | 浮层 main:${meta.mainOverlays?.length || 0} frame:${meta.frameOverlays?.length || 0}` : ''
  log(`✓ 快照 #${seq} → dev/snapshots/${dirName}/  (卡片 ${meta.frame?.count ?? '?'} 张${overlayNote})`)
}

async function main () {
  log('启动浏览器（复用项目 stealth + 已存登录）…')
  const { puppeteer } = await initPuppeteer()
  const launchOpts = await buildRecruiterLaunchOptions({ headless: false })
  const browser = await puppeteer.launch(launchOpts)
  const page = (await browser.pages())[0]

  const bossCookies = readStorageFile('boss-cookies.json')
  const bossLocalStorage = readStorageFile('boss-local-storage.json')
  const persistProfile = (readConfigFile('boss-recruiter.json') || {})?.advanced?.persistProfile === true
  if (!persistProfile && Array.isArray(bossCookies) && bossCookies.length > 0) {
    await page.setCookie(...bossCookies)
  }
  await setDomainLocalStorage(browser, localStoragePageUrl, bossLocalStorage || {})

  log('导航到推荐牛人页…')
  await page.goto(BOSS_RECOMMEND_PAGE_URL, { timeout: 60 * 1000 }).catch((e) => log('goto 警告:', e.message))
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 120 * 1000 }).catch(() => {})
  await sleep(1500)
  await page.bringToFront()

  // 等待登录（若被重定向到首页/登录页）
  const onRecommend = () => page.url().startsWith(BOSS_RECOMMEND_PAGE_URL)
  if (!onRecommend()) {
    log('似乎未登录，请在弹出的浏览器里完成登录（扫码），登录回到推荐牛人页后我会继续…')
    await page.waitForFunction(
      (url) => location.href.startsWith(url) && document.readyState === 'complete',
      { timeout: 300 * 1000 }, BOSS_RECOMMEND_PAGE_URL
    ).catch(() => log('等待登录超时，仍可手动操作'))
    await sleep(1500)
  }

  await dismissGovernanceNoticeDialog(page).catch(() => {})

  // 登录成功（已在推荐牛人页）→ 回存登录信息，下次免登录
  if (onRecommend()) {
    await storeStorage(page)
  }

  // 等待 recommendFrame 出现
  const getFrame = () => page.frames().find((f) => f.name() === 'recommendFrame') ?? null
  log('等待推荐牛人 iframe（recommendFrame）…')
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const f = getFrame()
    if (f) {
      const ok = await f.$('ul.card-list > li.card-item').catch(() => null)
      if (ok) break
    }
    await sleep(500)
  }
  log(getFrame() ? '✓ iframe 就绪' : '⚠ 未检测到 iframe/卡片，仍可手动操作后抓快照')

  // 串行化抓取（自动 + 手动共用），避免并发 evaluate；忙时合并为一次补抓
  let busy = false
  let pending = null
  const requestCapture = async (label, full = false) => {
    if (busy) { pending = { label, full }; return }
    busy = true
    try {
      await captureSnapshot(page, getFrame, label, full)
    } catch (e) {
      log('抓取失败:', e.message)
    } finally {
      busy = false
    }
    if (pending) { const p = pending; pending = null; await requestCapture(p.label, p.full) }
  }
  // ── 自动抓取：Node 侧轮询主页面 + recommendFrame 的「状态指纹」，状态变化稳定后自动抓一张 ──
  // 不再往 iframe 注入 __captureSignal（跨 frame 绑定不可靠，这是之前一张都抓不到的根因）。
  let lastFp = null      // 上一拍看到的指纹（用于判稳定）
  let stableFp = null    // 已经抓过快照的稳定指纹（避免重复抓同一状态）
  let lastState = { m: null, f: null }
  const labelFor = (m, f) => {
    const ov = ((f && f.overlays) || []).concat((m && m.overlays) || [])
    if ((f && f.dialogActive) || (m && m.dialogActive)) return 'resume-modal'
    if (ov.some((c) => /card-reason|reason/.test(c))) return 'reason-popup'
    if (ov.some((c) => /dialog|popup/.test(c))) return 'popup'
    return 'list'
  }
  const pollOnce = async () => {
    if (busy) return
    let m = null
    let f = null
    try { m = await page.evaluate(readStateInPage) } catch (e) { /* 导航中 */ }
    const fr = getFrame()
    if (fr) { try { f = await fr.evaluate(readStateInPage) } catch (e) { /* 导航中 */ } }
    const fp = JSON.stringify({ m, f })
    if (fp !== lastFp) {
      // 还在变化 —— 记下，等下一拍稳定了再抓
      lastFp = fp
      lastState = { m, f }
      return
    }
    // 已稳定：与上次抓过的指纹不同才抓
    if (fp !== stableFp) {
      stableFp = fp
      await requestCapture(labelFor(lastState.m, lastState.f), false)
    }
  }
  const pollTimer = setInterval(() => { pollOnce().catch(() => {}) }, 600)

  console.log('\n==================== 抓取就绪（每 600ms 轮询，状态变化自动抓） ====================')
  console.log('在浏览器里自然操作 —— 卡片数/滚动/浮层/简历弹窗一变且稳定下来就【自动】抓快照')
  console.log('（自动标签：list / resume-modal / reason-popup / popup）。')
  console.log('也可手动：输入标签+回车（空=snapshot，full=整页，r=重置自动基线，q=退出）')
  console.log('快照写入：dev/snapshots/<seq>-<label>/\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'capture> ' })
  rl.prompt()
  rl.on('line', async (line) => {
    const cmd = line.trim()
    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      rl.close()
      return
    }
    if (cmd === 'r') {
      lastFp = null
      stableFp = null
      log('已重置自动抓取基线（下次状态变化会重新抓）')
      rl.prompt()
      return
    }
    const full = cmd === 'full'
    const label = full ? 'full' : cmd
    await requestCapture(label || 'snapshot', full)
    rl.prompt()
  })
  rl.on('close', async () => {
    clearInterval(pollTimer)
    log('退出前回存最新登录信息…')
    await storeStorage(page).catch(() => {})
    log('关闭浏览器…')
    await browser.close().catch(() => {})
    process.exit(0)
  })
}

main().catch((e) => {
  console.error('[capture] 致命错误:', e)
  process.exit(1)
})
