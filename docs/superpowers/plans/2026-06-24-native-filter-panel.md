# 原生筛选面板能力层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个通用、无意见的原语 `applyNativeFilter(page, frame, cursor, plan)`，把 BOSS 推荐页原生「筛选」面板按给定计划设好并如实汇报，不触碰主循环时序。

**Architecture:** 纯层（catalog + `normalizeOption` + `planNativeFilter`，全 TDD）/ impure driver（仿 `actions.mjs` ghost-cursor 模式，整组回读验证，有界 deadline，绝不抛）/ 选择器集中在 `constant.mjs` / 配置走 `candidate-filter.json` 的 `nativeFilter` 块 + per-job 透传 / 一个一次性调试命令打真账号。

**Tech Stack:** ESM `.mjs`（无构建）、`node:test`、puppeteer、ghost-cursor、Electron worker（TS）。

参考 spec：`docs/superpowers/specs/2026-06-24-native-filter-panel-design.md`。所有命令在 worktree `.worktrees/native-filter`、分支 `feat/recommend-native-filter` 下运行。

---

## File Structure

- Create `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.mjs` — catalog、`normalizeOption`、`planNativeFilter`
- Create `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.test.mjs` — 纯层单测
- Create `packages/boss-auto-browse-and-chat/recommend/native-filter-driver.mjs` — `applyNativeFilter`
- Modify `packages/boss-auto-browse-and-chat/constant.mjs` — 面板选择器（追加到文件末尾推荐页区）
- Modify `packages/boss-auto-browse-and-chat/default-config-file/candidate-filter.json` — 加 `"nativeFilter": { "enabled": false }`
- Modify `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs` — `jobFilterToCandidateFilter` 加一行透传
- Modify `packages/boss-auto-browse-and-chat/recommend/pure/job-filter-passthrough.test.mjs` — 加 nativeFilter 透传断言
- Modify `packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts` — `apply-native-filter` + `diagnose-filter` 两个 case
- Modify `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts` — 给 `apply-native-filter` 放大超时

---

## Task 1: 纯层 — catalog + normalizeOption + planNativeFilter (TDD)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.mjs`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.test.mjs`

- [ ] **Step 1: 写失败测试**

写入 `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOption, planNativeFilter, NATIVE_FILTER_CATALOG } from './native-filter.mjs'

// 注入 fixture catalog，使单测不依赖生产真值
const CAT = {
  degree: { groupClass: 'degree', vip: false, single: false, options: ['大专', '本科', '硕士', '博士'] },
  salary: { groupClass: 'salary', vip: false, single: true, options: ['5-10K', '10-20K', '20-50K'] },
  school: { groupClass: 'school', vip: true, single: false, options: ['985', '211', '双一流院校'] },
  major: { groupClass: 'major', vip: true, single: false, options: null } // 动态（按职位变）
}

test('normalizeOption 去掉前后/中间空白与换行', () => {
  assert.equal(normalizeOption('\n    本科\n'), '本科')
  assert.equal(normalizeOption('本 科'), '本科')
  assert.equal(normalizeOption('1-3年'), '1-3年')
})

test('normalizeOption 容错 null/undefined', () => {
  assert.equal(normalizeOption(null), '')
  assert.equal(normalizeOption(undefined), '')
})

test('enabled:false / 缺省 → 空计划', () => {
  assert.deepEqual(planNativeFilter({ enabled: false, degree: ['本科'] }, CAT), { apply: [], skipped: [] })
  assert.deepEqual(planNativeFilter(undefined, CAT), { apply: [], skipped: [] })
})

test('多选维度：合法项进 apply（存原始 catalog 文案）', () => {
  const p = planNativeFilter({ degree: ['本科', '硕士'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科', '硕士'] }])
  assert.deepEqual(p.skipped, [])
})

test('多选维度：非法项进 skipped，合法项仍 apply', () => {
  const p = planNativeFilter({ degree: ['本科', '专科'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科'] }])
  assert.deepEqual(p.skipped, [{ group: 'degree', value: '专科', reason: 'unknown-option' }])
})

test('全非法 → apply 空、全 skipped', () => {
  const p = planNativeFilter({ degree: ['x', 'y'] }, CAT)
  assert.deepEqual(p.apply, [])
  assert.equal(p.skipped.length, 2)
})

test('单选维度：给数组只取首个', () => {
  const p = planNativeFilter({ salary: ['10-20K', '20-50K'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'salary', single: true, options: ['10-20K'] }])
})

test('单选维度：给字符串照常', () => {
  const p = planNativeFilter({ salary: '10-20K' }, CAT)
  assert.deepEqual(p.apply, [{ group: 'salary', single: true, options: ['10-20K'] }])
})

test('多选维度：给字符串包成单元素', () => {
  const p = planNativeFilter({ school: '985' }, CAT)
  assert.deepEqual(p.apply, [{ group: 'school', single: false, options: ['985'] }])
})

test('空值不进 apply 也不进 skipped', () => {
  const p = planNativeFilter({ degree: [], salary: '', school: null }, CAT)
  assert.deepEqual(p, { apply: [], skipped: [] })
})

test('归一匹配：配置带空格也能命中 catalog 原文', () => {
  const p = planNativeFilter({ degree: ['本 科'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科'] }])
})

test('动态维度(major, options:null)：原样透传不校验', () => {
  const p = planNativeFilter({ major: ['食品科学类'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'major', single: false, options: ['食品科学类'] }])
  assert.deepEqual(p.skipped, [])
})

test('生产 catalog 形状自洽：每项含 groupClass/vip/single/options', () => {
  for (const [g, m] of Object.entries(NATIVE_FILTER_CATALOG)) {
    assert.equal(m.groupClass, g)
    assert.equal(typeof m.vip, 'boolean')
    assert.equal(typeof m.single, 'boolean')
    assert.ok(m.options === null || Array.isArray(m.options))
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/boss-auto-browse-and-chat && node --test recommend/pure/native-filter.test.mjs`
Expected: FAIL（`Cannot find module './native-filter.mjs'`）

- [ ] **Step 3: 写实现**

写入 `packages/boss-auto-browse-and-chat/recommend/pure/native-filter.mjs`：

```js
/**
 * 推荐页原生「筛选」面板的纯逻辑层：选项目录 + 文案归一 + 计划生成。
 * 无 IO、确定可测。VIP 门禁不在此判断（运行期才知道），由 driver 决定。
 */

/** 唯一的文案归一：去掉全部空白（含中间换行）。planner 校验与 driver 读 DOM 必须共用此函数。 */
export function normalizeOption (s) {
  return String(s ?? '').replace(/\s+/g, '')
}

/**
 * 选项目录 = 合法值的唯一真相来源。options 为面板精确文案；options:null 表示动态（按职位变，如专业大类），planner 不静态校验，交 driver 运行期回读。
 * single/options 的真值需用 diagnose-filter 对真站点核对后定稿（带 [单选] 的：活跃度/跳槽频率/薪资）。
 */
export const NATIVE_FILTER_CATALOG = {
  // 免费维度
  degree: { groupClass: 'degree', vip: false, single: false, options: ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'] },
  experience: { groupClass: 'experience', vip: false, single: false, options: ['在校/应届', '25年毕业', '26年毕业', '26年后毕业', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'] },
  intention: { groupClass: 'intention', vip: false, single: false, options: ['离职-随时到岗', '在职-暂不考虑', '在职-考虑机会', '在职-月内到岗'] },
  salary: { groupClass: 'salary', vip: false, single: true, options: ['3K以下', '3-5K', '5-10K', '10-20K', '20-50K', '50K以上'] },
  // VIP 维度（高级筛选）
  activation: { groupClass: 'activation', vip: true, single: true, options: ['刚刚活跃', '今日活跃', '3日内活跃', '本周活跃', '本月活跃'] },
  gender: { groupClass: 'gender', vip: true, single: false, options: ['男', '女'] },
  school: { groupClass: 'school', vip: true, single: false, options: ['985', '211', '双一流院校', '留学', '国内外名校', '公办本科'] },
  major: { groupClass: 'major', vip: true, single: false, options: null },
  switchJobFrequency: { groupClass: 'switchJobFrequency', vip: true, single: true, options: ['5年少于3份', '平均每份工作大于1年'] }
}

/** catalog 里 vip:true 的组名集合，供 driver 判断是否需要展开折叠区 / VIP 锁。 */
export const VIP_GROUPS = new Set(
  Object.entries(NATIVE_FILTER_CATALOG).filter(([, m]) => m.vip).map(([g]) => g)
)

/**
 * 把 nativeFilter 配置解析成可执行计划。纯函数、VIP 无关。
 * @param {object|undefined} cfg - candidate-filter.json 的 nativeFilter 块
 * @param {object} [catalog] - 默认生产 catalog；单测注入 fixture
 * @returns {{apply: Array<{group:string,single:boolean,options:string[]}>, skipped: Array<{group:string,value:any,reason:string}>}}
 */
export function planNativeFilter (cfg, catalog = NATIVE_FILTER_CATALOG) {
  const apply = []
  const skipped = []
  if (!cfg || typeof cfg !== 'object' || cfg.enabled === false) return { apply, skipped }

  for (const [group, meta] of Object.entries(catalog)) {
    const raw = cfg[group]
    let values = raw == null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw])
    values = values.filter((v) => v != null && String(v).trim() !== '')
    if (meta.single) values = values.slice(0, 1)
    if (!values.length) continue // 空值：既不 apply 也不 skipped

    if (meta.options === null) {
      // 动态维度（如 major）：原样透传，运行期由 driver 回读校验
      apply.push({ group, single: meta.single, options: values.map((v) => String(v)) })
      continue
    }

    const matched = []
    for (const v of values) {
      const hit = meta.options.find((o) => normalizeOption(o) === normalizeOption(v))
      if (hit) matched.push(hit) // 存原始 catalog 文案
      else skipped.push({ group, value: v, reason: 'unknown-option' })
    }
    if (matched.length) apply.push({ group, single: meta.single, options: matched })
  }
  return { apply, skipped }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/boss-auto-browse-and-chat && node --test recommend/pure/native-filter.test.mjs`
Expected: PASS（全部 test）

- [ ] **Step 5: 提交**

```bash
git add packages/boss-auto-browse-and-chat/recommend/pure/native-filter.mjs packages/boss-auto-browse-and-chat/recommend/pure/native-filter.test.mjs
git commit -m "feat(recommend): pure native-filter planner + catalog + normalizeOption (TDD)"
```

---

## Task 2: 选择器 — constant.mjs

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/constant.mjs`（追加到推荐页选择器区，约 `RESUME_*` 之后、URL 常量之前；不破坏现有导出）

- [ ] **Step 1: 追加选择器常量**

在 `constant.mjs` 里 `export const RESUME_MODAL_CLOSE_SELECTOR ...` 行之后插入：

```js
// ===== 推荐页原生「筛选」面板（服务端预筛，主页面 #headerWrap 内；列表在 recommendFrame）=====
// 实现时用 diagnose-filter 对真站点核对触发器究竟在 page 还是 frame，以及各值。
/** 筛选按钮（点击展开 .filter-panel）。用户实测路径：#headerWrap … .recommend-filter.op-filter > div > div */
export const FILTER_PANEL_TRIGGER_SELECTOR = '.recommend-filter.op-filter > div > div'
export const FILTER_PANEL_SELECTOR = '.filter-panel'
/** VIP 高级筛选包裹；含 .vip-mask（锁）与 .vip-folded（折叠展开钮） */
export const FILTER_VIP_WRAP_SELECTOR = '.filter-panel .vip-filters-wrap'
export const FILTER_VIP_FOLDED_SELECTOR = '.filter-panel .vip-filters-wrap .vip-folded'
export const FILTER_VIP_MASK_SELECTOR = '.filter-panel .vip-filters-wrap .vip-mask'
/** 折叠态标记：含此 class 表示当前是折叠的（需点 vip-folded 展开） */
export const FILTER_VIP_FOLDED_STATE_CLASS = 'show-folded'
/** 某维度的选项组容器；用法：`${FILTER_PANEL_SELECTOR} .check-box.${groupClass}` */
export const filterGroupSelector = (groupClass) => `${FILTER_PANEL_SELECTOR} .check-box.${groupClass}`
/** 组内单个选项（.default.option 是「不限」复位项）；major 的 .option 可能嵌在 .popover 里，故用后代匹配 */
export const FILTER_OPTION_SELECTOR = '.option'
export const FILTER_OPTION_DEFAULT_SELECTOR = '.default.option'
/** 选项选中态 class（实测核对，疑似 active） */
export const FILTER_OPTION_ACTIVE_CLASS = 'active'
/** 底部按钮：优先按文案匹配，class 仅回退 */
export const FILTER_BTNS_SELECTOR = '.filter-panel .btns .btn'
export const FILTER_CONFIRM_TEXT = '确定'
export const FILTER_CLEAR_TEXT = '清除'
/** 筛选后零结果空态屏（实测用 diagnose-filter 核对，先放保守候选） */
export const FILTER_LIST_EMPTY_SELECTOR = '.recommend-empty, .empty-wrap, .no-result'
```

- [ ] **Step 2: 语法自检**

Run: `cd packages/boss-auto-browse-and-chat && node -e "import('./constant.mjs').then(m=>{if(typeof m.filterGroupSelector!=='function')throw new Error('bad');console.log('constant ok', m.filterGroupSelector('degree'))})"`
Expected: 打印 `constant ok .filter-panel .check-box.degree`

- [ ] **Step 3: 提交**

```bash
git add packages/boss-auto-browse-and-chat/constant.mjs
git commit -m "feat(recommend): native filter panel selectors in constant.mjs"
```

---

## Task 3: 配置默认 + per-job 透传 (TDD)

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/default-config-file/candidate-filter.json`
- Modify: `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs:190-202`
- Modify: `packages/boss-auto-browse-and-chat/recommend/pure/job-filter-passthrough.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `recommend/pure/job-filter-passthrough.test.mjs` 末尾追加：

```js
test('passes through nativeFilter object', () => {
  const nf = { enabled: true, degree: ['本科'], salary: '10-20K' }
  const out = __jobFilterToCandidateFilter({ nativeFilter: nf })
  assert.deepEqual(out.nativeFilter, nf)
})
test('nativeFilter absent → undefined (not dropped into a wrong shape)', () => {
  const out = __jobFilterToCandidateFilter({})
  assert.equal(out.nativeFilter, undefined)
})
test('nativeFilter non-object → undefined', () => {
  const out = __jobFilterToCandidateFilter({ nativeFilter: 'x' })
  assert.equal(out.nativeFilter, undefined)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/boss-auto-browse-and-chat && node --test recommend/pure/job-filter-passthrough.test.mjs`
Expected: FAIL（`out.nativeFilter` 为 undefined 但首个用例期望等于 nf）

- [ ] **Step 3: 加透传行**

在 `runtime-file-utils.mjs` 的 `jobFilterToCandidateFilter` 返回对象里（`skipViewedCandidates: ...` 行之后）加一行：

```js
    skipViewedCandidates: f.skipViewedCandidates === true,
    nativeFilter: f.nativeFilter && typeof f.nativeFilter === 'object' ? f.nativeFilter : undefined
```

（即把原 `skipViewedCandidates: f.skipViewedCandidates === true` 行尾补逗号并追加 `nativeFilter` 行。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/boss-auto-browse-and-chat && node --test recommend/pure/job-filter-passthrough.test.mjs`
Expected: PASS

- [ ] **Step 5: 改默认配置**

把 `default-config-file/candidate-filter.json` 的 `"skipViewedCandidates": false` 行补逗号并加一行，使文件成为：

```json
{
  "expectCityList": [],
  "expectEducationRegExpStr": "",
  "expectWorkExpRange": [0, 99],
  "expectSalaryRange": [0, 0],
  "expectSalaryWhenNegotiable": "exclude",
  "expectSkillKeywords": [],
  "blockCandidateNameRegExpStr": "",
  "skipViewedCandidates": false,
  "nativeFilter": { "enabled": false }
}
```

- [ ] **Step 6: 校验 JSON 合法**

Run: `cd packages/boss-auto-browse-and-chat && node -e "console.log(require('./default-config-file/candidate-filter.json').nativeFilter)"`
Expected: 打印 `{ enabled: false }`

- [ ] **Step 7: 提交**

```bash
git add packages/boss-auto-browse-and-chat/runtime-file-utils.mjs packages/boss-auto-browse-and-chat/default-config-file/candidate-filter.json packages/boss-auto-browse-and-chat/recommend/pure/job-filter-passthrough.test.mjs
git commit -m "feat(recommend): nativeFilter config default + per-job passthrough"
```

---

## Task 4: driver — applyNativeFilter (impure，build-check + 真账号手测)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/native-filter-driver.mjs`

> driver 无法离线单测（需真账号 DOM），照仓库 `actions.mjs` 惯例：实现 + LIVE-SMOKE PENDING 注释，靠 Task 5 的调试命令手测。

- [ ] **Step 1: 写实现**

写入 `packages/boss-auto-browse-and-chat/recommend/native-filter-driver.mjs`：

```js
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { waitForState, detectState, STATES } from './page-state.mjs'
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

const DEADLINE_MS = 45000

const clickEl = async (cursor, el) => {
  await cursor.click(el).catch(async () => { await el.click().catch(() => {}) })
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
    const ok = await ctx.$(selector).then((e) => !!e).catch(() => false)
    if (ok) return true
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
  if (toggle) { await toggle.click().catch(() => {}); await sleep(300) }
}

/** 点该组内文案归一后等于 target 的选项（default/不限 不算）。返回是否点到。 */
async function clickOption (ctx, cursor, groupClass, targetRaw) {
  const groupSel = filterGroupSelector(groupClass)
  const opts = await ctx.$$(`${groupSel} ${FILTER_OPTION_SELECTOR}`).catch(() => [])
  const target = normalizeOption(targetRaw)
  for (const el of opts) {
    const txt = await el.evaluate((n) => n.textContent || '').catch(() => '')
    const isDefault = await el.evaluate((n) => n.classList.contains('default')).catch(() => false)
    if (!isDefault && normalizeOption(txt) === target) { await clickEl(cursor, el); await sleep(150); return true }
  }
  return false
}

/** 回读该组当前选中态（active 的非 default 选项文案，归一）。 */
async function readActive (ctx, groupClass) {
  const groupSel = filterGroupSelector(groupClass)
  return ctx
    .$$eval(`${groupSel} ${FILTER_OPTION_SELECTOR}`, (els, activeCls) =>
      els
        .filter((e) => !e.classList.contains('default') && e.classList.contains(activeCls))
        .map((e) => (e.textContent || '').replace(/\s+/g, '')), FILTER_OPTION_ACTIVE_CLASS)
    .catch(() => [])
}

/** 点该组「不限」复位（清空再选，保证幂等）。 */
async function clearGroup (ctx, cursor, groupClass) {
  const sel = `${filterGroupSelector(groupClass)} ${FILTER_OPTION_DEFAULT_SELECTOR}`
  const def = await ctx.$(sel).catch(() => null)
  if (def) { await clickEl(cursor, def); await sleep(120) }
}

/** 按文案点底部按钮（确定/清除）；class 回退。 */
async function clickBtnByText (ctx, cursor, text) {
  const btns = await ctx.$$(FILTER_BTNS_SELECTOR).catch(() => [])
  for (const b of btns) {
    const t = await b.evaluate((n) => (n.textContent || '').trim()).catch(() => '')
    if (t === text) { await clickEl(cursor, b); return true }
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
  if (!apply.length) { report.ok = true; return report } // plan 为空：成功 no-op

  const deadline = Date.now() + DEADLINE_MS
  try {
    const ctx = await resolvePanelCtx(page, frame)
    if (!ctx) { report.reason = 'panel-not-opened'; return report }

    const trigger = await ctx.$(FILTER_PANEL_TRIGGER_SELECTOR).catch(() => null)
    if (!trigger) { report.reason = 'panel-not-opened'; return report }
    await clickEl(cursor, trigger)
    if (!(await waitVisible(ctx, FILTER_PANEL_SELECTOR, 6000))) { report.reason = 'panel-not-opened'; return report }

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
      // 整组回读：applied = 目标 ∩ 实际选中；未生效 → click-no-effect
      const active = await readActive(ctx, a.group)
      const got = []
      for (const opt of a.options) {
        if (active.includes(normalizeOption(opt))) got.push(opt)
        else report.skipped.push({ group: a.group, value: opt, reason: 'click-no-effect' })
      }
      if (got.length) report.applied.push({ group: a.group, options: got })
    }

    await clickBtnByText(ctx, cursor, FILTER_CONFIRM_TEXT)

    // 等列表稳定：LIST 或 零结果空态 任一，带有界超时；绝不死等
    const listDeadline = Math.min(deadline, Date.now() + 8000)
    while (Date.now() < listDeadline) {
      if ((await detectState(page, frame)) === STATES.LIST) break
      const empty = await frame
        ? frame.$(FILTER_LIST_EMPTY_SELECTOR).then((e) => !!e).catch(() => false)
        : false
      if (empty) { report.listEmptyAfterApply = true; break }
      await sleep(400)
    }
    if (!report.listEmptyAfterApply) {
      report.listEmptyAfterApply = !(await waitForState(page, frame, STATES.LIST, { timeoutMs: 1 }))
        ? report.listEmptyAfterApply
        : false
    }

    report.ok = true
    return report
  } catch (err) {
    report.reason = 'driver-error'
    return report
  }
}

// LIVE-SMOKE PENDING: 经 Task 5 的 `apply-native-filter` 调试命令在真账号上验证：
// 免费维度生效、VIP 锁降级、零结果空态不挂、幂等重复一致、面板打不开报 panic-not-opened。
```

- [ ] **Step 2: 模块可加载自检**

Run: `cd packages/boss-auto-browse-and-chat && node -e "import('./recommend/native-filter-driver.mjs').then(m=>{if(typeof m.applyNativeFilter!=='function')throw new Error('bad');console.log('driver loads ok')})"`
Expected: 打印 `driver loads ok`（确认 import 链与语法正确）

- [ ] **Step 3: 提交**

```bash
git add packages/boss-auto-browse-and-chat/recommend/native-filter-driver.mjs
git commit -m "feat(recommend): applyNativeFilter driver (impure, live-smoke pending)"
```

---

## Task 5: 调试命令 — apply-native-filter + diagnose-filter + 超时放大

**Files:**
- Modify: `packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts`（`switch (type)` 内加 case；顶部动态 import 加两模块）
- Modify: `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts:1038`（按 type 放大超时）

- [ ] **Step 1: 在 worker 顶部动态 import 区加入纯层与 driver**

在 `BOSS_RECOMMEND_DEBUG_MAIN/index.ts` 现有 `const { scrollGently } = (await import(...))` 之类动态 import 群组后，追加：

```ts
  const { planNativeFilter } = (await import(
    /* @vite-ignore */ '@geekgeekrun/boss-auto-browse-and-chat/recommend/pure/native-filter.mjs'
  )) as any
  const { applyNativeFilter } = (await import(
    /* @vite-ignore */ '@geekgeekrun/boss-auto-browse-and-chat/recommend/native-filter-driver.mjs'
  )) as any
```

> 注意：用与同文件其它动态 import 完全一致的包说明符前缀（照抄 `scrapeCards`/`scrollGently` 那几行的写法，仅换路径），保证解析一致。

- [ ] **Step 2: 在 `switch (type)` 内加两个 case**

在 `case 'diagnose-reject'` 之后、`default`（或 switch 结尾）之前插入：

```ts
        case 'apply-native-filter': {
          if (!frame) { reply(true, { ok: false, reason: 'no-frame', applied: [], skipped: [], listEmptyAfterApply: false }); break }
          const nativeFilter = cmd.nativeFilter ?? {}
          const plan = planNativeFilter(nativeFilter)
          const report = await applyNativeFilter(page, frame, cursor, plan)
          // 业务级 ok:false 仍用协议成功回传整份报告（协议 false 只给 worker 异常）
          reply(true, { plan, report })
          break
        }

        case 'diagnose-filter': {
          // dump 面板结构：触发器在哪、各组 class、选项文案、单选多选迹象、VIP 锁、空态候选
          const ctx: any = (await page.$('.recommend-filter.op-filter')) ? page : frame
          if (!ctx) { reply(true, { triggerCtx: 'none' }); break }
          const trig = await ctx.$('.recommend-filter.op-filter').catch(() => null)
          if (trig) { await trig.click().catch(() => {}) ; await new Promise((r) => setTimeout(r, 600)) }
          const dump = await ctx.evaluate(() => {
            const panel = document.querySelector('.filter-panel')
            if (!panel) return { panelOpen: false }
            const groups = Array.from(panel.querySelectorAll('.check-box')).map((g: any) => ({
              cls: typeof g.className === 'string' ? g.className : '',
              options: Array.from(g.querySelectorAll('.option')).map((o: any) => ({
                text: (o.textContent || '').replace(/\s+/g, ''),
                isDefault: o.classList.contains('default'),
                active: o.classList.contains('active')
              }))
            }))
            const vipMask = !!panel.querySelector('.vip-filters-wrap .vip-mask')
            const folded = !!panel.querySelector('.vip-filters-wrap.show-folded')
            const btns = Array.from(panel.querySelectorAll('.btns .btn')).map((b: any) => ({
              cls: typeof b.className === 'string' ? b.className : '',
              text: (b.textContent || '').trim()
            }))
            return { panelOpen: true, vipMask, folded, groups, btns }
          })
          reply(true, dump)
          break
        }
```

- [ ] **Step 3: IPC 超时按 type 放大**

把 `OPEN_SETTING_WINDOW/ipc/index.ts` 的 `setTimeout(() => rej(new Error('timeout')), 60000)` 改为：

```ts
    const cmdTimeoutMs = cmd.type === 'apply-native-filter' ? 150000 : 60000
    try {
      const result = await Promise.race([
        defer.promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), cmdTimeoutMs))
      ])
      return { ok: true, result }
```

（即在 `try` 前定义 `cmdTimeoutMs`，并把 race 里的 `60000` 换成 `cmdTimeoutMs`。）

- [ ] **Step 4: UI typecheck/build**

Run: `pnpm -F geekgeekrun-ui build`
Expected: 构建通过（无新 TS 报错）。若 `typecheck:web` 因既有 vue-tsc 问题失败属已知（见 PR 说明），以 build 为准。

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts
git commit -m "feat(debug): apply-native-filter + diagnose-filter recommend debug commands"
```

---

## Task 6: 全量验证 + 收尾

- [ ] **Step 1: 跑全包单测**

Run: `cd packages/boss-auto-browse-and-chat && node --test`
Expected: 全绿（含新 native-filter + passthrough）。

- [ ] **Step 2: 跑 monorepo 测试**

Run: `pnpm -r --if-present test`
Expected: 既有 + 新增全绿。

- [ ] **Step 3: 标注 live-smoke 待办**

确认 driver 文件底部 LIVE-SMOKE PENDING 注释在；在 PR/交接里列出真账号手测清单（见 spec 实测清单 1–9）。

- [ ] **Step 4: 最终提交（若有零散改动）**

```bash
git add -A && git commit -m "chore(recommend): native-filter capability layer wrap-up" || echo "nothing to commit"
```

---

## Self-review 记录

- Spec 覆盖：catalog/normalizeOption/planNativeFilter（T1）、选择器（T2）、配置默认+per-job 透传（T3）、driver 含整组回读/清空再选/幂等折叠/有界 deadline/空态/ok-reason 报告（T4）、调试命令+协议 ok 不混淆+frame 守卫+超时放大（T5）、全量测试（T6）。
- 类型一致：`planNativeFilter(cfg, catalog)`、`applyNativeFilter(page, frame, cursor, plan)`、报告字段 `ok/reason/applied/skipped/listEmptyAfterApply`、`VIP_GROUPS`、`normalizeOption`、`filterGroupSelector` 在各 Task 间一致。
- 已知 live 待核对（非阻塞，driver 不崩兜底）：触发器 page/frame、各组 single 真值、选中态 class、空态选择器 —— 全部由 `diagnose-filter` 真账号核对后微调 catalog/selector。
