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
      continue
    }
    if (st === STATES.QUOTA_BLOCKED) break
    if (st !== STATES.LIST) { await selfHeal(page, frame); continue }

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

      // Stage B: open resume → assertIdentity → readSummary → score
      if (!await openResume(page, frame, cursor, c.encryptGeekId)) {
        seen.add(c.encryptGeekId)
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
        if (ok) budgets.greet--
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
