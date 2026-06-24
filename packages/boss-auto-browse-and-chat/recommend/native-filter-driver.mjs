import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { detectState, STATES } from './page-state.mjs'
import { normalizeOption, VIP_GROUPS } from './pure/native-filter.mjs'
import {
  FILTER_PANEL_TRIGGER_SELECTOR,
  FILTER_PANEL_SELECTOR,
  FILTER_VIP_WRAP_SELECTOR,
  FILTER_VIP_FOLDED_SELECTOR,
  FILTER_VIP_MASK_SELECTOR,
  FILTER_VIP_FOLDED_STATE_CLASS,
  filterGroupSelector,
  FILTER_OPTION_SELECTOR,
  FILTER_OPTION_DEFAULT_SELECTOR,
  FILTER_OPTION_ACTIVE_CLASS,
  FILTER_BTNS_SELECTOR,
  FILTER_CONFIRM_TEXT,
  FILTER_LIST_EMPTY_SELECTOR
} from '../constant.mjs'

/** driver 自身的硬上限：永远在此 deadline 内返回报告而非挂起。 */
const DEADLINE_MS = 45000

const clickEl = async (cursor, el) => {
  await cursor.click(el).catch(async () => {
    await el.click().catch(() => {})
  })
}

/** 在 page 或 frame 里找面板触发器所在的上下文（主页面优先，回退 frame）。 */
async function resolvePanelCtx (page, frame) {
  if (await page.$(FILTER_PANEL_TRIGGER_SELECTOR).then((e) => !!e).catch(() => false)) return page
  if (frame && (await frame.$(FILTER_PANEL_TRIGGER_SELECTOR).then((e) => !!e).catch(() => false))) return frame
  return null
}

async function waitVisible (ctx, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ctx.$(selector).then((e) => !!e).catch(() => false)) return true
    await sleep(200)
  }
  return false
}

/** 仅在折叠时点展开（幂等）。 */
async function ensureVipExpanded (ctx) {
  const folded = await ctx
    .$eval(FILTER_VIP_WRAP_SELECTOR, (el, cls) => el.classList.contains(cls), FILTER_VIP_FOLDED_STATE_CLASS)
    .catch(() => false)
  if (!folded) return
  const toggle = await ctx.$(FILTER_VIP_FOLDED_SELECTOR).catch(() => null)
  if (toggle) {
    await toggle.click().catch(() => {})
    await sleep(300)
  }
}

/** 点该组内文案归一后等于 target 的选项（default/不限 不算）。 */
async function clickOption (ctx, cursor, groupClass, targetRaw) {
  const groupSel = filterGroupSelector(groupClass)
  const opts = await ctx.$$(`${groupSel} ${FILTER_OPTION_SELECTOR}`).catch(() => [])
  const target = normalizeOption(targetRaw)
  for (const el of opts) {
    const txt = await el.evaluate((n) => n.textContent || '').catch(() => '')
    const isDefault = await el.evaluate((n) => n.classList.contains('default')).catch(() => false)
    if (!isDefault && normalizeOption(txt) === target) {
      await clickEl(cursor, el)
      await sleep(150)
      return true
    }
  }
  return false
}

/** 回读该组当前选中态（active 的非 default 选项文案，归一）。 */
async function readActive (ctx, groupClass) {
  const groupSel = filterGroupSelector(groupClass)
  return ctx
    .$$eval(
      `${groupSel} ${FILTER_OPTION_SELECTOR}`,
      (els, activeCls) =>
        els
          .filter((e) => !e.classList.contains('default') && e.classList.contains(activeCls))
          .map((e) => (e.textContent || '').replace(/\s+/g, '')),
      FILTER_OPTION_ACTIVE_CLASS
    )
    .catch(() => [])
}

/** 点该组「不限」复位（清空再选，保证幂等）。 */
async function clearGroup (ctx, cursor, groupClass) {
  const sel = `${filterGroupSelector(groupClass)} ${FILTER_OPTION_DEFAULT_SELECTOR}`
  const def = await ctx.$(sel).catch(() => null)
  if (def) {
    await clickEl(cursor, def)
    await sleep(120)
  }
}

/** 按文案点底部按钮（确定/清除）；class 回退。 */
async function clickBtnByText (ctx, cursor, text) {
  const btns = await ctx.$$(FILTER_BTNS_SELECTOR).catch(() => [])
  for (const b of btns) {
    const t = await b.evaluate((n) => (n.textContent || '').trim()).catch(() => '')
    if (t === text) {
      await clickEl(cursor, b)
      return true
    }
  }
  return false
}

/**
 * 按 plan 操作原生筛选面板一次。通用、无意见：不读配置、不碰预算、不决定时机。
 * @param {import('puppeteer').Page} page 开面板（主页面）
 * @param {import('puppeteer').Frame} frame 确认列表刷新（recommendFrame）
 * @param {object} cursor ghost-cursor
 * @param {{apply:Array,skipped:Array}} plan planNativeFilter 的产物
 * @returns {Promise<{ok:boolean,reason?:string,applied:Array,skipped:Array,listEmptyAfterApply:boolean}>}
 */
export async function applyNativeFilter (page, frame, cursor, plan) {
  const report = {
    ok: false,
    reason: undefined,
    applied: [],
    skipped: [...((plan && plan.skipped) || [])],
    listEmptyAfterApply: false
  }
  const apply = (plan && plan.apply) || []
  if (!apply.length) {
    report.ok = true
    return report
  } // plan 为空：成功 no-op

  const deadline = Date.now() + DEADLINE_MS
  try {
    const ctx = await resolvePanelCtx(page, frame)
    if (!ctx) {
      report.reason = 'panel-not-opened'
      return report
    }

    const trigger = await ctx.$(FILTER_PANEL_TRIGGER_SELECTOR).catch(() => null)
    if (!trigger) {
      report.reason = 'panel-not-opened'
      return report
    }
    await clickEl(cursor, trigger)
    if (!(await waitVisible(ctx, FILTER_PANEL_SELECTOR, 6000))) {
      report.reason = 'panel-not-opened'
      return report
    }

    const wantVip = apply.some((a) => VIP_GROUPS.has(a.group))
    let vipLocked = false
    if (wantVip) {
      await ensureVipExpanded(ctx)
      vipLocked = await ctx.$(FILTER_VIP_MASK_SELECTOR).then((e) => !!e).catch(() => false)
    }

    for (const a of apply) {
      if (VIP_GROUPS.has(a.group) && vipLocked) {
        for (const v of a.options) report.skipped.push({ group: a.group, value: v, reason: 'vip-locked' })
        continue
      }
      if (Date.now() > deadline) break
      await clearGroup(ctx, cursor, a.group)
      for (const opt of a.options) await clickOption(ctx, cursor, a.group, opt)
      // 整组回读：applied = 目标 ∩ 实际选中；未生效 → click-no-effect。天然兼容单选自动反选。
      const active = await readActive(ctx, a.group)
      const got = []
      for (const opt of a.options) {
        if (active.includes(normalizeOption(opt))) got.push(opt)
        else report.skipped.push({ group: a.group, value: opt, reason: 'click-no-effect' })
      }
      if (got.length) report.applied.push({ group: a.group, options: got })
    }

    await clickBtnByText(ctx, cursor, FILTER_CONFIRM_TEXT)

    // 等列表稳定：LIST 或 零结果空态 任一，带有界超时；绝不死等 LIST。
    const listDeadline = Math.min(deadline, Date.now() + 8000)
    while (Date.now() < listDeadline) {
      if ((await detectState(page, frame)) === STATES.LIST) {
        report.listEmptyAfterApply = false
        break
      }
      const empty = frame
        ? await frame.$(FILTER_LIST_EMPTY_SELECTOR).then((e) => !!e).catch(() => false)
        : false
      if (empty) {
        report.listEmptyAfterApply = true
        break
      }
      await sleep(400)
    }

    report.ok = true
    return report
  } catch (err) {
    report.reason = 'driver-error'
    return report
  }
}

// LIVE-SMOKE PENDING: 经 BOSS_RECOMMEND_DEBUG_MAIN 的 `apply-native-filter` 调试命令在真账号上验证：
// 免费维度生效、VIP 锁降级、零结果空态不挂、幂等重复一致、面板打不开报 panel-not-opened。
// 并用 `diagnose-filter` 核对：触发器在 page/frame、各组 single 真值、选中态 class、空态选择器。
