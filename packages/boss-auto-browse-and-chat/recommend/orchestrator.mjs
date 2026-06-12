import { createHumanCursor } from '../humanMouse.mjs'
import { sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { detectState, selfHeal, STATES } from './page-state.mjs'
import { scrapeCards } from './list-scraper.mjs'
import { cheapPrescore } from './pure/prescore.mjs'
import { ruleFilterList } from './pure/rule-filter.mjs'
import { score } from './scorer.mjs'
import { openResume, assertIdentity, readSummary, greetInModal, closeResume } from './resume-inspector.mjs'
import { rejectFromList, scrollGently } from './actions.mjs'
import { shouldClickX } from './pure/x-guard.mjs'
import { checkpointRiskControl } from '../risk-detector.mjs'

/** 连续无法恢复到 LIST 状态的最大次数，超过则中止本次运行（防止卡死空转） */
const MAX_STUCK_HEALS = 5

/**
 * 推荐页波次主循环。
 * @param {import('puppeteer').Page} page
 * @param {() => import('puppeteer').Frame|null} getFrame - 取 recommendFrame
 * @param {object} hooks - tapable hooks（run-core 提供）
 * @param {object} cfg - recommendPage + scoring + rules 合并配置
 *   cfg.maxGreetPerRun, cfg.maxXPerRun, cfg.maxScrollSteps, cfg.maxStaleWaves,
 *   cfg.waveSize, cfg.minScoreToChat, cfg.onScoreError, cfg.rules, cfg.llm,
 *   cfg.delayBetweenActionsMs, cfg.scrollDelayMsRange
 * @param {(payload:object)=>Promise<{score:number,reason?:string}>} [llmFn]
 */
export async function runRecommendLoop (page, getFrame, hooks, cfg, llmFn) {
  const cursor = await createHumanCursor(page)
  const budgets = { greet: cfg.maxGreetPerRun, x: cfg.maxXPerRun, scroll: cfg.maxScrollSteps }
  const seen = new Set()
  let staleWaves = 0
  let stuckHeals = 0 // 连续无法回到 LIST 的次数，超阈值则中止，避免卡死空转
  let greeted = 0

  while (true) {
    const frame = getFrame()
    const st = await detectState(page, frame)

    // Override 1: ACCOUNT_BANNED first, VERIFY uses checkpointRiskControl,
    // QUOTA_BLOCKED checked BEFORE the !== LIST catch-all
    if (st === STATES.ACCOUNT_BANNED)
      throw new Error('ACCOUNT_BANNED: recommend loop aborted for account safety')
    if (st === STATES.VERIFY) {
      const r = await checkpointRiskControl(page, { log: (m) => console.warn('[recommend]', m) })
      if (r === 'timed-out') break
      stuckHeals = 0
      continue
    }
    if (st === STATES.QUOTA_BLOCKED) break
    if (st !== STATES.LIST) {
      // selfHeal 无法处理的状态（如 UNKNOWN）会原样返回；连续多次仍非 LIST 则中止
      if (++stuckHeals > MAX_STUCK_HEALS) {
        console.warn('[recommend] 连续无法恢复到列表状态，中止本次运行')
        break
      }
      await selfHeal(page, frame)
      continue
    }
    stuckHeals = 0

    // Scrape and filter unseen cards
    let cards = (await scrapeCards(frame)).filter((c) => !seen.has(c.encryptGeekId))
    if (hooks?.onCandidateListLoaded) await hooks.onCandidateListLoaded.promise(cards).catch(() => {})

    // Build interactable wave
    let wave = cards.filter((c) => c.interactable)
    if (!wave.length) {
      if (budgets.greet <= 0 || budgets.scroll <= 0 || staleWaves >= cfg.maxStaleWaves) break
      await scrollGently(page, cfg)
      budgets.scroll--
      continue
    }

    // Best-first sort by cheap prescore, cap at waveSize
    wave = wave.sort((a, b) => cheapPrescore(b) - cheapPrescore(a)).slice(0, cfg.waveSize)

    let newCount = 0
    for (const c of wave) {
      // 逐候选人安全闸：波次进行中页面若离开 LIST（验证码/封禁/弹窗）立即跳出，
      // 交给外层状态机暂停/自愈，避免在风控浮层上继续盲点（本 PR 核心目标）。
      const cst = await detectState(page, frame)
      if (cst === STATES.ACCOUNT_BANNED)
        throw new Error('ACCOUNT_BANNED: recommend loop aborted for account safety')
      if (cst !== STATES.LIST) break

      // Stage A: rule pre-filter (list text only) → X if reject
      const pre = ruleFilterList(c, cfg.rules || {})
      if (pre.result === 'reject') {
        if (hooks?.onCandidateFiltered)
          await hooks.onCandidateFiltered.promise([c], { matched: false, reason: pre.reason }).catch(() => {})
        if (budgets.x > 0 && shouldClickX(cfg)) {
          if (await rejectFromList(page, frame, cursor, c.encryptGeekId, pre.reason)) budgets.x--
        }
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }

      // 过初筛的候选人只能通过"打招呼"消费；招呼额度耗尽时开简历评分纯属浪费
      // （ruleGate 用的是同一份列表数据，必然 pass，不会产生 hardReject→X），直接跳过。
      if (budgets.greet <= 0) {
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }

      // Stage B: open resume → assertIdentity → readSummary → score
      if (!await openResume(page, frame, cursor, c.encryptGeekId)) {
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }
      if (!await assertIdentity(frame, c.geekName)) {
        await closeResume(page, frame, cursor)
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }
      const resume = await readSummary(frame)
      const scored = await score(c, resume, cfg, llmFn)

      // Stage C: hardReject → close + X; score≥min + budget → greet; else close
      if (scored.hardReject) {
        await closeResume(page, frame, cursor)
        if (budgets.x > 0 && shouldClickX(cfg)) {
          if (await rejectFromList(page, frame, cursor, c.encryptGeekId, scored.reason)) budgets.x--
        }
      } else if (scored.score >= cfg.minScoreToChat && budgets.greet > 0) {
        if (hooks?.beforeStartChat) await hooks.beforeStartChat.promise(c).catch(() => {})
        const ok = await greetInModal(frame, cursor)
        if (ok) {
          budgets.greet--
          greeted++
          if (hooks?.onProgress)
            await hooks.onProgress
              .promise({ phase: 'recommend', current: greeted, max: cfg.maxGreetPerRun })
              .catch(() => {})
        }
        if (hooks?.afterChatStarted)
          await hooks.afterChatStarted.promise(c, { greeted: ok, score: scored.score }).catch(() => {})
        await closeResume(page, frame, cursor)
      } else {
        await closeResume(page, frame, cursor)
      }

      seen.add(c.encryptGeekId)
      newCount++
      await sleepWithRandomDelay(
        cfg.delayBetweenActionsMs?.[0] ?? 1500,
        cfg.delayBetweenActionsMs?.[1] ?? 4000
      )
      if (budgets.greet <= 0 && budgets.x <= 0) break
    }

    staleWaves = newCount === 0 ? staleWaves + 1 : 0
    if (budgets.greet <= 0 && budgets.x <= 0) break
  }
}
