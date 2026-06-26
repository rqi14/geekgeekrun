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
import { createRetryingPool } from './pure/concurrency.mjs'
import { planNativeFilter } from './pure/native-filter.mjs'
import { applyNativeFilter } from './native-filter-driver.mjs'
import { fieldKnockout } from './pure/field-knockout.mjs'
import { schoolTier } from './school-tier.mjs'
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

/** 候选人多段教育里最高的学校层级 rank（用于开简历排序：先学校档次后启发式） */
function bestSchoolRank (schools) {
  const arr = Array.isArray(schools) ? schools : []
  let best = 0
  for (const s of arr) { const r = schoolTier(s).rank; if (r > best) best = r }
  return best
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
  // dry-run 不真打招呼，不受真实 greet/view 额度限制（onlyViewed 时重看已看过的人也不烧查看）
  if (!cfg.dryRun && (budgets.greet <= 0 || budgets.view <= 0)) return

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
  let fieldKnockedOut = 0 // 卡片层专业/方向对口判定淘汰的人数（dry-run 报告用）
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
      const fk = fieldKnockout(
        { majors: c.majors, advantage: c.skills, expectDirection: c.expectDirection },
        cfg.fieldRules || {}
      )
      if (fk.result === 'knockout') { fieldKnockedOut++; continue }
      c._schoolRank = bestSchoolRank(c.schools)
      pool.set(c.encryptGeekId, c)
    }
    staleScrolls = pool.size === before ? staleScrolls + 1 : 0
    if (pool.size >= target || staleScrolls >= cfg.maxStaleWaves) break
    await scrollGently(page, cfg)
  }

  const openSet = rankForOpen(
    [...pool.values()],
    (c) => (c._schoolRank || 0) * 1000 + cheapPrescore(c),
    budgets.view
  )

  // ---------- B 相：串行抽简历（烧查看额度）+ 并发评分 ----------
  // 浏览器抽取必须串行（单页面）；但每抽到一份简历就把 LLM 评分丢进并发池后台跑，
  // 抽下一份时上一份正在评分，把 N×(抽+评) 串行压成 ~抽取墙钟 + 末尾评分。
  // 评分并发池 + 有界自动重试：评分撞限流/网络/解析失败（llmError）→ 重新入队重试，
  // 最多 scoreMaxAttempts 次，退避 2s/4s…（退避期间释放并发槽）；用尽仍失败 → 落 0 分(fail-closed)。
  const scheduleScore = createRetryingPool({
    concurrency: cfg.scoreConcurrency ?? 4,
    maxAttempts: Math.max(1, cfg.scoreMaxAttempts ?? 3),
    shouldRetry: (entry) => entry?.llmError === true,
    backoffMs: (attempt) => Math.min(15000, 2000 * attempt)
  })
  const scoringTasks = []
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
    await closeResume(page, frame, cursor)
    // 身份校验快照：canvas 全文须含候选人姓名或其某个学校，否则视为未确认（可能抓空/串号）
    const idNeedles = [c.geekName, ...(Array.isArray(c.schools) ? c.schools : [])].filter(Boolean)
    const canvasOk = !!fullText && idNeedles.some((n) => fullText.includes(n))
    const resume = { summary: summaryObj.summary, fullText: fullText || summaryObj.summary, canvasOk }
    // 评分只调 LLM、不碰浏览器，进并发池后台跑；闭包捕获的是已抽好的快照字符串，
    // 与下一份的 clearCapturedText/captureResumeText 不冲突。
    scoringTasks.push(
      scheduleScore(async (attempt) => {
        if (attempt > 1) console.warn(`[recommend] 评分重试 ${c.geekName}（第 ${attempt} 次）`)
        const s = await score(c, resume, cfg, llmFn)
        return {
          candidate: c,
          score: s.score,
          hardReject: s.hardReject,
          reason: canvasOk ? s.reason : ((s.reason || '') + ' [canvas未确认→不打招呼]'),
          resumeChars: (fullText || '').length,
          canvasOk,
          llmError: s.llmError === true
        }
      })
    )
    await sleepWithRandomDelay(
      cfg.delayBetweenActionsMs?.[0] ?? 1500,
      cfg.delayBetweenActionsMs?.[1] ?? 4000
    )
  }
  // 等所有并发评分落地（score() 内部已吞 LLM 异常；allSettled 再兜一层，异常项丢弃）
  const settled = await Promise.allSettled(scoringTasks)
  const scored = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value)

  // 评分失败（重试用尽仍 llmError）聚合成一条通知 → GUI 弹窗提示用户（这些人按 0 分 fail-closed，不会误打招呼）
  const scoreFailed = scored.filter((s) => s.llmError === true)
  if (scoreFailed.length && hooks?.onScoreError) {
    await hooks.onScoreError
      .promise({
        failedCount: scoreFailed.length,
        total: scored.length,
        names: scoreFailed.map((s) => s.candidate?.geekName).filter(Boolean)
      })
      .catch(() => {})
  }

  // 硬不达标的人补 X：延后到评分全部落地后串行做（卡片不虚拟化、仍在列表里）
  if (!cfg.dryRun) {
    for (const r of scored) {
      if (budgets.x <= 0) break
      if (!r.hardReject || !shouldClickX(cfg)) continue
      const frame = getFrame()
      const g = await guard(frame)
      if (g === 'break') break
      if (g === 'retry') continue
      await scrollCardIntoView(frame, r.candidate.encryptGeekId)
      if (await rejectFromList(page, frame, cursor, r.candidate.encryptGeekId, r.reason, r.candidate)) {
        budgets.x--
      }
    }
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
      fieldKnockedOut,
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
        schoolRank: s.candidate._schoolRank ?? 0,
        canvasOk: s.canvasOk,
        llmError: s.llmError === true
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
