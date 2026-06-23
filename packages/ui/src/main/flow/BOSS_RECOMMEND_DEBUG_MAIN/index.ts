/**
 * 招聘端「推荐牛人页」调试 worker：启动浏览器到推荐页，等待主进程通过 stdio fd3 发来的调试命令。
 * 与 BOSS_CHAT_DEBUG_MAIN 同构（fd3=父写→子读，fd4=子写→父读，JSON 行协议，命令带 id）。
 *
 * 支持命令：
 *   - ping：探活
 *   - detect-state：返回当前推荐页状态（LIST / RESUME_MODAL / VERIFY / …）
 *   - scrape-cards：识别当前可见的候选人卡片，返回字段数组（姓名/学历/经验/技能/可达性等）
 *   - scroll：在列表上做一次温和滚动（加载下一波）
 *   - open-resume { encryptGeekId }：打开该候选人简历弹窗，校验身份并读取摘要
 *   - greet：在已打开的简历弹窗里点「打招呼」
 *   - close-resume：关闭简历弹窗
 *   - reject { encryptGeekId, reason }：在列表上对该候选人点「不合适」
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import attachListenerForKillSelfOnParentExited from '../../utils/attachListenerForKillSelfOnParentExited'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import * as JSONStream from 'JSONStream'
import { pipeWriteRegardlessError } from '../utils/pipe'

const log = (msg: string) => console.log(`[boss-recommend-debug-worker] ${msg}`)

// 子进程侧：fd3=读（命令），fd4=写（READY/结果）
const cmdReadStream = fs.createReadStream(null as any, { fd: 3 })
const replyWriteStream = fs.createWriteStream(null as any, { fd: 4 })

const send = (obj: object) => {
  pipeWriteRegardlessError(replyWriteStream, JSON.stringify(obj) + '\n')
}

const runDebug = async () => {
  app.dock?.hide()
  log('启动推荐页调试工具...')

  const puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  if (!puppeteerExecutable) {
    log('未找到可用浏览器，退出')
    send({ type: 'READY', ok: false, error: 'NO_BROWSER' })
    app.exit(1)
    return
  }
  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath

  const { initPuppeteer } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/index.mjs'
  )) as any
  const { scrapeCards } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/list-scraper.mjs'
  )) as any
  const { openResume, assertIdentity, readSummary, greetInModal, closeResume } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/resume-inspector.mjs'
  )) as any
  const { scrollGently } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/actions.mjs'
  )) as any
  const { detectState } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/page-state.mjs'
  )) as any
  const { createHumanCursor } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/humanMouse.mjs'
  )) as any
  const { readStorageFile, ensureStorageFileExist } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/runtime-file-utils.mjs'
  )) as any
  const { BOSS_RECOMMEND_PAGE_URL } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/constant.mjs'
  )) as any
  const { setDomainLocalStorage } = (await import(
    '@geekgeekrun/utils/puppeteer/local-storage.mjs'
  )) as any

  const { puppeteer } = await initPuppeteer()
  ensureStorageFileExist()

  log('启动浏览器...')
  const browser = await puppeteer.launch({
    headless: false,
    ignoreHTTPSErrors: true,
    protocolTimeout: 120000,
    defaultViewport: { width: 1440, height: 900 - 140 }
  })

  const page = (await browser.pages())[0]

  const bossCookies = readStorageFile('boss-cookies.json')
  const bossLocalStorage = readStorageFile('boss-local-storage.json')
  if (Array.isArray(bossCookies) && bossCookies.length > 0) {
    await page.setCookie(...bossCookies)
  }
  await setDomainLocalStorage(browser, 'https://www.zhipin.com/desktop/', bossLocalStorage || {})
  await page.goto(BOSS_RECOMMEND_PAGE_URL, { timeout: 60000 })
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 120000 })

  // 推荐页候选人列表在 iframe[name="recommendFrame"] 内异步渲染，可能多次重建，每次命令时重新获取。
  const getRecommendFrame = () => page.frames().find((f: any) => f.name() === 'recommendFrame') ?? null

  log('页面已加载，发送 READY（若未登录请在浏览器内手动登录后再用命令）')
  send({ type: 'READY', ok: true })

  browser.once('disconnected', () => {
    log('浏览器已关闭，退出')
    app.exit(0)
  })

  const DEBUG_SCROLL_CFG = { scrollDelayMsRange: [800, 2000] }

  cmdReadStream.pipe(JSONStream.parse()).on('data', async (cmd: any) => {
    const { id, type } = cmd ?? {}
    if (!id || !type) return
    log(`收到命令: ${type} (id=${id})`)

    const reply = (ok: boolean, result?: any, error?: string) => send({ id, ok, result, error })

    try {
      const cursor = await createHumanCursor(page)
      const frame = getRecommendFrame()

      switch (type) {
        case 'ping':
          reply(true, 'pong')
          break

        case 'snapshot': {
          // 失败分析用:截图 + 保存 recommendFrame 与主页面 HTML 到 ~/.geekgeekrun/debug-snapshots/
          const dir = path.join(os.homedir(), '.geekgeekrun', 'debug-snapshots')
          fs.mkdirSync(dir, { recursive: true })
          const ts = new Date().toISOString().replace(/[:.]/g, '-')
          const tag = String(cmd.tag || 'snap').replace(/[^\w-]/g, '')
          const base = `${ts}_${tag}`
          const png = path.join(dir, base + '.png')
          await page.screenshot({ path: png, fullPage: false }).catch(() => {})
          const frameHtml = frame ? await frame.content().catch(() => '') : '(无 recommendFrame)'
          const pageHtml = await page.content().catch(() => '')
          const htmlPath = path.join(dir, base + '.html')
          fs.writeFileSync(
            htmlPath,
            `<!-- ===== recommendFrame HTML ===== -->\n${frameHtml}\n\n<!-- ===== MAIN PAGE HTML ===== -->\n${pageHtml}`
          )
          reply(true, { dir, png, html: htmlPath })
          break
        }

        case 'detect-state': {
          const state = await detectState(page, frame)
          reply(true, { state, hasFrame: !!frame })
          break
        }

        case 'scrape-cards': {
          if (!frame) { reply(false, null, '未找到 recommendFrame（请确认已登录并停在推荐牛人页）'); break }
          const cards = await scrapeCards(frame)
          reply(true, { count: cards.length, cards })
          break
        }

        case 'scroll': {
          await scrollGently(page, DEBUG_SCROLL_CFG)
          reply(true, { scrolled: true })
          break
        }

        case 'open-resume': {
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const { encryptGeekId, geekName } = cmd
          if (!encryptGeekId) { reply(false, null, '缺少 encryptGeekId'); break }
          const opened = await openResume(page, frame, cursor, encryptGeekId)
          if (!opened) { reply(false, { opened: false }, '打开简历失败（卡片可能已滚出或被拦截）'); break }
          const identityOk = geekName ? await assertIdentity(frame, geekName) : true
          const summary = await readSummary(frame).catch(() => null)
          reply(true, { opened: true, identityOk, summary })
          break
        }

        case 'greet': {
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const greeted = await greetInModal(frame, cursor)
          reply(greeted, { greeted })
          break
        }

        case 'close-resume': {
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          await closeResume(page, frame, cursor)
          reply(true, { closed: true })
          break
        }

        case 'reject': {
          // 列表卡片「不感兴趣」自适应版:点 X → 等原因弹窗 → 自适应选原因(优先「其他原因」,
          // 否则选最后一项,以适配每个职位选项不同)→ 等弹窗关闭。逐步返回结果便于诊断。
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const { encryptGeekId } = cmd
          if (!encryptGeekId) { reply(false, null, '缺少 encryptGeekId'); break }
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
          const steps: any = {}

          const xHandle = await frame.evaluateHandle((id: string) => {
            const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
            const li = inner ? inner.closest('li.card-item') : null
            return li ? li.querySelector('div.tooltip-wrap.suitable') : null
          }, encryptGeekId)
          const x = xHandle.asElement()
          steps.xFound = !!x
          if (!x) { reply(false, steps, 'X(不感兴趣)按钮未找到——可能简历弹窗开着,或选择器已变,请用「诊断不合适」'); break }
          await (cursor.click(x).catch(async () => { await (x as any).click().catch(() => {}) }))

          let popupEl: any = null
          for (let i = 0; i < 12; i++) {
            await sleep(300)
            popupEl = await frame.$('div.card-reason-f1.show')
            if (popupEl) break
          }
          steps.reasonPopupAppeared = !!popupEl
          if (!popupEl) { reply(false, steps, '原因弹窗未出现(div.card-reason-f1.show)——请用「诊断不合适」查看真实结构'); break }

          const options: string[] = await frame.$$eval(
            'div.card-reason-f1.show span.first-reason-item',
            (els: any[]) => els.map((e) => (e.textContent || '').trim())
          )
          steps.options = options
          const items = await frame.$$('div.card-reason-f1.show span.first-reason-item')
          if (!items.length) { reply(false, steps, '原因弹窗内未找到选项(span.first-reason-item)——请用「诊断不合适」'); break }
          let idx = options.findIndex((o) => o.includes('其他'))
          if (idx < 0) idx = items.length - 1 // 自适应:没有「其他原因」就选最后一项
          steps.chosenReason = options[idx]
          await (cursor.click(items[idx]).catch(async () => { await (items[idx] as any).click().catch(() => {}) }))

          // 部分职位选完原因还需点确认按钮;尝试点一下常见确认按钮(有则点,无则忽略)
          await sleep(600)
          const confirmed = await frame.evaluate(() => {
            const pop = document.querySelector('div.card-reason-f1.show')
            if (!pop) return 'popup-closed'
            const btn = Array.from(pop.querySelectorAll('button,[class*="btn"],[class*="confirm"],[class*="submit"]'))
              .find((b) => /确定|确认|提交|完成|确定优化/.test((b.textContent || '').trim())) as HTMLElement | undefined
            if (btn) { btn.click(); return 'clicked-confirm' }
            return 'no-confirm-btn'
          })
          steps.confirmStep = confirmed
          await sleep(700)
          const popupGone = await frame.evaluate(() => !document.querySelector('div.card-reason-f1.show'))
          steps.popupClosed = popupGone
          reply(popupGone, steps, popupGone ? undefined : '已选原因但弹窗未关闭——请用「诊断不合适」看是否有未处理的确认控件')
          break
        }

        case 'diagnose-modal-reject': {
          // 简历弹窗内的「不合适」按钮探测:dump 弹窗里的按钮 class/文本,用于定位
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const dump = await frame.evaluate(() => {
            const modal = document.querySelector('div.dialog-wrap.active .dialog-lib-resume')
            if (!modal) return { modalOpen: false }
            const btns = Array.from(modal.querySelectorAll('button,[class*="btn"],[class*="suitable"],[class*="unfit"],[class*="dislike"],[class*="operate"]'))
              .map((e) => ({ cls: typeof e.className === 'string' ? e.className : '', text: (e.textContent || '').trim().slice(0, 24) }))
              .filter((o) => o.text || o.cls)
              .slice(0, 50)
            return { modalOpen: true, buttons: btns }
          })
          reply(true, dump)
          break
        }

        case 'diagnose-reject': {
          // 分步诊断「不合适」流程,把每步结果 + 原因弹窗真实 DOM 结构吐出来,用于定位选择器
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const { encryptGeekId } = cmd
          if (!encryptGeekId) { reply(false, null, '缺少 encryptGeekId'); break }
          const diag: any = {}
          // 1. 定位卡片与 X(不感兴趣)按钮
          const probe = await frame.evaluate((id: string) => {
            const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
            const li = inner ? inner.closest('li.card-item') : null
            const x = li ? li.querySelector('div.tooltip-wrap.suitable') : null
            // 同时把卡片内所有疑似 X/不感兴趣 的元素 className 列出来(以防选择器变了)
            const candidates = li
              ? Array.from(li.querySelectorAll('[class*="suitable"],[class*="tooltip"],[class*="dislike"],[class*="close"],[class*="unfit"]'))
                  .map((e) => (typeof e.className === 'string' ? e.className : ''))
                  .filter(Boolean)
                  .slice(0, 20)
              : []
            return { cardFound: !!inner, liFound: !!li, xFound: !!x, xCandidates: candidates }
          }, encryptGeekId)
          diag.locate = probe
          if (!probe.xFound) { reply(true, diag); break }
          // 2. 点 X
          const xHandle = await frame.evaluateHandle((id: string) => {
            const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
            const li = inner ? inner.closest('li.card-item') : null
            return li ? li.querySelector('div.tooltip-wrap.suitable') : null
          }, encryptGeekId)
          const x = xHandle.asElement()
          if (x) {
            await (cursor.click(x).catch(async () => { await (x as any).click().catch(() => {}) }))
          }
          diag.clickedX = !!x
          await new Promise((r) => setTimeout(r, 1500))
          // 3. 检查原因弹窗 + dump 结构
          const popup = await frame.evaluate(() => {
            const known = document.querySelector('div.card-reason-f1.show')
            const target = known
              || document.querySelector('[class*="card-reason"]')
              || document.querySelector('[class*="reason"][class*="show"]')
            if (!target) {
              const overlays = Array.from(document.querySelectorAll('[class*="reason"],[class*="dialog"],[class*="popup"],[class*="feedback"]'))
                .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
                .map((e) => (typeof e.className === 'string' ? e.className : ''))
                .slice(0, 20)
              return { found: false, knownSelectorMatched: false, visibleOverlayClasses: overlays }
            }
            const items = Array.from(target.querySelectorAll('span.first-reason-item')).map((e) => (e.textContent || '').trim())
            const clickable = Array.from(target.querySelectorAll('span,div,li,button,a'))
              .map((e) => ({ cls: typeof e.className === 'string' ? e.className : '', text: (e.textContent || '').trim() }))
              .filter((o) => o.text && o.text.length > 0 && o.text.length <= 24)
              .slice(0, 40)
            return {
              found: true,
              knownSelectorMatched: !!known,
              className: typeof target.className === 'string' ? target.className : '',
              firstReasonItems: items,
              clickableTexts: clickable,
              htmlSnippet: (target as HTMLElement).outerHTML.slice(0, 2000)
            }
          })
          diag.reasonPopup = popup
          reply(true, diag)
          break
        }

        default:
          reply(false, null, `未知命令: ${type}`)
      }
    } catch (err: any) {
      log(`命令 ${type} 执行出错: ${err?.message}`)
      reply(false, null, err?.message ?? String(err))
    }
  })
}

export const waitForProcessHandShakeAndRunDebug = async () => {
  await app.whenReady()
  app.on('window-all-closed', () => {
    // keep alive
  })
  runDebug()
}

attachListenerForKillSelfOnParentExited()
