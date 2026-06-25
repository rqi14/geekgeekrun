import { createHumanCursor } from '../humanMouse.mjs'
import { sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { detectState, selfHeal, STATES } from './page-state.mjs'
import { scrapeCards } from './list-scraper.mjs'
import { cheapPrescore } from './pure/prescore.mjs'
import { ruleFilterList } from './pure/rule-filter.mjs'
import { score } from './scorer.mjs'
import { openResume, assertIdentity, readSummary, closeResume, captureResumeText } from './resume-inspector.mjs'
import { rejectFromList, scrollGently, scrollCardIntoView, greetFromCard } from './actions.mjs'
import { shouldClickX } from './pure/x-guard.mjs'
import { checkpointRiskControl } from '../risk-detector.mjs'
import { readQuota } from './quota-reader.mjs'
import { rankForOpen, selectForGreet } from './pure/selection.mjs'
import { planNativeFilter } from './pure/native-filter.mjs'
import { applyNativeFilter } from './native-filter-driver.mjs'
import { BUSINESS_BLOCK_DIALOG_CLOSE_SELECTOR, BOSS_RECOMMEND_PAGE_URL } from '../constant.mjs'

/** 推荐页 URL 关键字（被跳走到 user-center 等页面时用于识别"已离开推荐页"） */
const RECOMMEND_URL_KEYWORD = '/web/chat/recommend'

/** 连续无法恢复到 LIST 状态的最大次数，超过则中止本次运行（防止卡死空转） */
const MAX_STUCK_HEALS = 5

/** 关掉 VIP 业务拦截弹窗（额度耗尽时弹出），关不掉也不抛错 */
async function closeBusinessBlock (page) {
  const btn = await page.$(BUSINESS_BLOCK_DIALOG_CLOSE_SELECTOR).catch(() => null)
  if (btn) await btn.click().catch(() => {})
}

/**
 * 推荐页"批选漏斗"主循环：收集+排序 → 开简历打分（烧查看额度）→ 选最高分打招呼（烧沟通额度）。
 * 起跑读真实剩余配额 seed 预算；任何动作前 detectState，命中 business-block 即对应预算清零、关弹窗、停。
 * @param {import('puppeteer').Page} page
 * @param {() => import('puppeteer').Frame|null} getFrame - 取 recommendFrame
 * @param {object} hooks - tapable hooks（run-core 提供）
 * @param {object} cfg - recommendPage + scoring + rules 合并配置
 *   cfg.maxGreetPerRun, cfg.maxViewPerRun, cfg.maxXPerRun, cfg.maxStaleWaves,
 *   cfg.waveSize, cfg.minScoreToChat, cfg.onScoreError, cfg.rules, cfg.llm,
 *   cfg.delayBetweenActionsMs, cfg.scrollDelayMsRange,
 *   cfg.dryRun, cfg.onlyViewed, cfg.dryRunMaxOpen
 * @param {(payload:object)=>Promise<{score:number,reason?:string}>} [llmFn]
 */
export async function runRecommendLoop (page, getFrame, hooks, cfg, llmFn) {
  const cursor = await createHumanCursor(page)
  const q = await readQuota(page).catch(() => null)
  const liveGreet = q?.greet?.remaining
  const liveView = q?.view?.remaining
  const budgets = {
    greet: Math.min(cfg.maxGreetPerRun ?? Infinity, liveGreet ?? cfg.maxGreetPerRun ?? 0),
    view: Math.min(cfg.maxViewPerRun ?? Infinity, liveView ?? cfg.maxViewPerRun ?? 20),
    x: cfg.maxXPerRun
  }
  if (budgets.greet <= 0 || budgets.view <= 0) return

  // Layer-0 服务端预筛（操作基座）：设一次原生筛选面板，改变"推谁"。enabled=false→plan 空→no-op。
  if (cfg.nativeFilter?.enabled) {
    const plan = planNativeFilter(cfg.nativeFilter)
    const report = await applyNativeFilter(page, getFrame(), cursor, plan).catch(() => null)
    if (report?.listEmptyAfterApply) {
      console.warn('[recommend] 原生筛选后列表为空，本轮无人可处理')
      return
    }
  }

  // 状态守卫：返回 'list' | 'break' | 'retry'
  let stuckHeals = 0
  async function guard (frame) {
    // URL 守卫：被跳走（如 /web/chat/user-center）→ 导航回推荐页，绝不在错页上继续操作
    if (!page.url().includes(RECOMMEND_URL_KEYWORD)) {
      if (++stuckHeals > MAX_STUCK_HEALS) return 'break'
      console.warn('[recommend] 已离开推荐页（当前 URL：' + page.url() + '），导航回推荐页')
      await page.goto(BOSS_RECOMMEND_PAGE_URL, { timeout: 60000 }).catch(() => {})
      await page
        .waitForFunction(() => document.readyState === 'complete', { timeout: 60000 })
        .catch(() => {})
      return 'retry'
    }
    const st = await detectState(page, frame)
    if (st === STATES.ACCOUNT_BANNED)
      throw new Error('ACCOUNT_BANNED: recommend loop aborted for account safety')
    if (st === STATES.VERIFY) {
      const r = await checkpointRiskControl(page, { log: (m) => console.warn('[recommend]', m) })
      stuckHeals = 0
      return r === 'timed-out' ? 'break' : 'retry'
    }
    if (st === STATES.QUOTA_BLOCKED) {
      await closeBusinessBlock(page)
      return 'break'
    }
    if (st !== STATES.LIST) {
      if (++stuckHeals > MAX_STUCK_HEALS) return 'break'
      await selfHeal(page, frame)
      return 'retry'
    }
    stuckHeals = 0
    return 'list'
  }

  // ---------- A 相：收集 + 免费规则初筛 + 排序 ----------
  const pool = new Map()
  const seen = new Set()
  let passedRule = 0 // 过了规则初筛的人数（onlyViewed 过滤之前），用于 dry-run 解释"为什么 pool=0"
  const target = Math.max((budgets.view || 0) * 2, cfg.waveSize)
  let staleScrolls = 0
  while (pool.size < target && budgets.view > 0) {
    const frame = getFrame()
    const g = await guard(frame)
    if (g === 'break') break
    if (g === 'retry') continue
    const before = pool.size
    const cards = (await scrapeCards(frame)).filter((c) => !seen.has(c.encryptGeekId))
    if (hooks?.onCandidateListLoaded) await hooks.onCandidateListLoaded.promise(cards).catch(() => {})
    for (const c of cards) {
      seen.add(c.encryptGeekId)
      const pre = ruleFilterList(c, cfg.rules || {})
      if (pre.result === 'reject') {
        if (hooks?.onCandidateFiltered)
          await hooks.onCandidateFiltered.promise([c], { matched: false, reason: pre.reason }).catch(() => {})
        if (!cfg.dryRun && budgets.x > 0 && shouldClickX(cfg) && c.interactable) {
          if (await rejectFromList(page, frame, cursor, c.encryptGeekId, pre.reason, c)) budgets.x--
        }
        continue
      }
      passedRule++
      if (cfg.onlyViewed && !c._hasViewed) continue
      pool.set(c.encryptGeekId, c)
    }
    staleScrolls = pool.size === before ? staleScrolls + 1 : 0
    if (pool.size >= target || staleScrolls >= cfg.maxStaleWaves) break
    await scrollGently(page, cfg)
  }

  const openSet = rankForOpen([...pool.values()], cheapPrescore, budgets.view)

  // ---------- B 相：开简历 + 打分（烧查看额度） ----------
  const scored = []
  let opened = 0
  for (const c of openSet) {
    if (cfg.dryRun) {
      if (opened >= (cfg.dryRunMaxOpen ?? 8)) break
    } else if (budgets.view <= 0) {
      break
    }
    const frame = getFrame()
    const g = await guard(frame)
    if (g === 'break') break
    if (g === 'retry') continue
    await scrollCardIntoView(frame, c.encryptGeekId)
    if (cfg.canvasHook?.clearCapturedText) await cfg.canvasHook.clearCapturedText(page).catch(() => {})
    if (!await openResume(page, frame, cursor, c.encryptGeekId)) {
      if ((await detectState(page, frame)) === STATES.QUOTA_BLOCKED) {
        await closeBusinessBlock(page)
        budgets.view = 0
      }
      continue
    }
    opened++
    if (!cfg.dryRun) budgets.view--
    if (!await assertIdentity(frame, c.geekName)) {
      await closeResume(page, frame, cursor)
      continue
    }
    const summaryObj = await readSummary(frame)
    const fullText = await captureResumeText(page, cfg.canvasHook)
    // 身份校验：canvas 全文须含候选人姓名或其某个学校，否则视为未确认（可能抓空/串号）
    const idNeedles = [c.geekName, ...(Array.isArray(c.schools) ? c.schools : [])].filter(Boolean)
    const canvasOk = !!fullText && idNeedles.some((n) => fullText.includes(n))
    const resume = { summary: summaryObj.summary, fullText: fullText || summaryObj.summary, canvasOk }
    const s = await score(c, resume, cfg, llmFn)
    scored.push({
      candidate: c,
      score: s.score,
      hardReject: s.hardReject,
      reason: canvasOk ? s.reason : ((s.reason || '') + ' [canvas未确认→不打招呼]'),
      resumeChars: (fullText || '').length,
      canvasOk
    })
    await closeResume(page, frame, cursor)
    if (!cfg.dryRun && s.hardReject && budgets.x > 0 && shouldClickX(cfg)) {
      if (await rejectFromList(page, frame, cursor, c.encryptGeekId, s.reason, c)) budgets.x--
    }
    await sleepWithRandomDelay(
      cfg.delayBetweenActionsMs?.[0] ?? 1500,
      cfg.delayBetweenActionsMs?.[1] ?? 4000
    )
  }

  // ---------- C 相：选最好 + 打招呼（烧沟通额度） ----------
  const greetable = scored.filter((s) => s.canvasOk !== false)
  const greetSet = selectForGreet(greetable, {
    minScore: cfg.minScoreToChat,
    greetBudget: cfg.dryRun ? greetable.length : budgets.greet
  })
  if (cfg.dryRun) {
    return {
      dryRun: true,
      onlyViewed: !!cfg.onlyViewed,
      scoringMode: cfg.llm?.rubric ? 'llm-rubric' : 'rule-only',
      minScoreToChat: cfg.minScoreToChat,
      passedRule,
      pool: pool.size,
      opened,
      scored: scored.map((s) => ({
        geekName: s.candidate.geekName,
        prescore: cheapPrescore(s.candidate),
        score: s.score,
        hardReject: s.hardReject,
        reason: s.reason,
        resumeChars: s.resumeChars ?? 0,
        hasViewed: !!s.candidate._hasViewed,
        canvasOk: s.canvasOk
      })),
      wouldGreet: greetSet.map((g) => ({ geekName: g.candidate.geekName, score: g.score })),
      budgets
    }
  }
  let greeted = 0
  for (const item of greetSet) {
    if (budgets.greet <= 0) break
    const frame = getFrame()
    const g = await guard(frame)
    if (g === 'break') break
    if (g === 'retry') continue
    const c = item.candidate
    await scrollCardIntoView(frame, c.encryptGeekId)
    if (hooks?.beforeStartChat) await hooks.beforeStartChat.promise(c).catch(() => {})
    const r = await greetFromCard(page, frame, cursor, c.encryptGeekId)
    if (r.quotaBlocked) {
      await closeBusinessBlock(page)
      budgets.greet = 0
      break
    }
    if (r.greeted) {
      budgets.greet--
      greeted++
      if (hooks?.onProgress)
        await hooks.onProgress
          .promise({ phase: 'recommend', current: greeted, max: cfg.maxGreetPerRun })
          .catch(() => {})
    }
    if (hooks?.afterChatStarted)
      await hooks.afterChatStarted.promise(c, { greeted: r.greeted, score: item.score }).catch(() => {})
    await sleepWithRandomDelay(
      cfg.delayBetweenActionsMs?.[0] ?? 1500,
      cfg.delayBetweenActionsMs?.[1] ?? 4000
    )
  }
}
