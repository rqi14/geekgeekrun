/**
 * 招聘端「推荐牛人页」调试 worker：启动浏览器到推荐页，等待主进程通过 stdio fd3 发来的调试命令。
 * 与 BOSS_CHAT_DEBUG_MAIN 同构（fd3=父写→子读，fd4=子写→父读，JSON 行协议，命令带 id）。
 *
 * 支持命令：
 *   - ping：探活
 *   - detect-state：返回当前推荐页状态（LIST / RESUME_MODAL / VERIFY / …）
 *   - read-quota：只读，打开账号权益侧栏读今日剩余「查看/沟通」额度（不烧配额）
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
  const { readQuota } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/quota-reader.mjs'
  )) as any
  const { classifyRejectReason } = (await import(
    '@geekgeekrun/boss-auto-browse-and-chat/recommend/pure/reject-reason-classifier.mjs'
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

        case 'read-quota': {
          // 只读：打开账号权益侧栏读今日剩余「查看/沟通」额度，再关回。不烧任何配额。
          const quota = await readQuota(page)
          reply(true, { quota })
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
          // 自适应:简历弹窗开着→点弹窗内「不合适」(.btn-quxiao);否则点列表卡片 X(div.tooltip-wrap.suitable)。
          // 点完都等原因弹窗(宽松匹配)→ 自适应选原因(优先「其他」否则末项)→ 必要时点确认 → 等关闭。
          if (!frame) { reply(false, null, '未找到 recommendFrame'); break }
          const { encryptGeekId } = cmd
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
          const steps: any = {}

          const modalOpen = await frame.evaluate(
            () => !!document.querySelector('div.dialog-wrap.active .dialog-lib-resume')
          )
          steps.context = modalOpen ? 'modal' : 'list'

          let btnHandle: any
          if (modalOpen) {
            btnHandle = await frame.evaluateHandle(
              () =>
                document.querySelector('div.dialog-wrap.active .dialog-lib-resume .btn-quxiao') ||
                document.querySelector('.btn-quxiao')
            )
          } else {
            if (!encryptGeekId) { reply(false, steps, '列表模式需要 encryptGeekId'); break }
            btnHandle = await frame.evaluateHandle((id: string) => {
              const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
              const li = inner ? inner.closest('li.card-item') : null
              return li ? li.querySelector('div.tooltip-wrap.suitable') : null
            }, encryptGeekId)
          }
          const btn = btnHandle.asElement()
          steps.rejectBtnFound = !!btn
          if (!btn) { reply(false, steps, '未找到「不合适」按钮——用「诊断不合适」查看'); break }
          await (cursor.click(btn).catch(async () => { await (btn as any).click().catch(() => {}) }))

          // 等原因弹窗(宽松:card-reason-f1 / 任意含 reason 的可见浮层)
          let popup: any = null
          for (let i = 0; i < 14; i++) {
            await sleep(300)
            popup = await frame.evaluate(() => {
              const sels = ['div.card-reason-f1.show', '[class*="card-reason"]', '[class*="reason"][class*="show"]']
              let p: Element | null = null
              for (const s of sels) {
                const el = document.querySelector(s)
                if (el) { const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) { p = el; break } }
              }
              if (!p) return null
              const items = Array.from(p.querySelectorAll('span.first-reason-item')).map((e) => (e.textContent || '').trim())
              const fallback = Array.from(p.querySelectorAll('span,li'))
                .map((e) => (e.textContent || '').trim())
                .filter((t) => t && t.length <= 24)
              return { className: (p as HTMLElement).className, items, fallback: fallback.slice(0, 40) }
            })
            if (popup) break
          }
          steps.reasonPopup = popup
          if (!popup) { reply(false, steps, '点了「不合适」但未出现原因弹窗——可能直接生效或结构不同,用「诊断不合适」'); break }

          const opts: string[] = (popup.items && popup.items.length ? popup.items : popup.fallback) || []
          steps.allOptions = opts
          if (!opts.length) { reply(false, steps, '原因弹窗内未识别到可选项——用「诊断不合适」'); break }
          // 自动分类:按候选人真实属性(cmd.card)在动态选项里挑最贴切的具体原因,避开需填输入的「其他原因」。
          const cls = classifyRejectReason(cmd.card || {}, opts)
          steps.classify = { reason: cls.reason, basis: cls.basis }
          const chosen: string = cls.reason || opts.find((o: string) => !/其他/.test(o)) || opts[0]
          steps.chosenReason = chosen
          const needsInput = /其他/.test(chosen)

          const clicked = await frame.evaluate((wanted: string) => {
            const p = document.querySelector('div.card-reason-f1.show') || document.querySelector('[class*="card-reason"]')
            if (!p) return false
            const list = Array.from(p.querySelectorAll('span.first-reason-item'))
            const cands = list.length ? list : Array.from(p.querySelectorAll('span,li'))
            const el = cands.find((e) => (e.textContent || '').trim() === wanted) as HTMLElement | undefined
            if (el) { el.click(); return true }
            return false
          }, chosen)
          steps.reasonClicked = clicked

          // 若只能选「其他原因」,顺手填一句意见,否则提交无效
          if (needsInput) {
            steps.filledInput = await frame.evaluate(() => {
              const p = document.querySelector('div.card-reason-f1.show')
              const ipt = p?.querySelector('input.ipt') as HTMLInputElement | undefined
              if (ipt) { ipt.value = '与岗位不匹配'; ipt.dispatchEvent(new Event('input', { bubbles: true })); return true }
              return false
            })
          }

          // 点「提交」
          await sleep(400)
          steps.submit = await frame.evaluate(() => {
            const p = document.querySelector('div.card-reason-f1.show')
            if (!p) return 'no-popup'
            const btn = (p.querySelector('.my-subbmit button.btn')
              || p.querySelector('.feed-back-list button.btn')
              || Array.from(p.querySelectorAll('button')).find((b) => /提交/.test((b.textContent || '').trim()))) as HTMLElement | undefined
            if (btn) { btn.click(); return 'clicked-submit' }
            return 'no-submit-btn'
          })
          await sleep(800)
          const gone = await frame.evaluate(() => !document.querySelector('div.card-reason-f1.show'))
          steps.popupClosed = gone
          reply(gone, steps, gone ? undefined : '选了原因+点了提交但弹窗仍未关——把本条 steps 贴我')
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
          // dump 完关掉原因弹窗,避免残留挡住后续操作
          await frame.evaluate(() => {
            const c = document.querySelector('div.card-reason-f1.show div.close-icon') as HTMLElement | null
            if (c) c.click()
          }).catch(() => {})
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
