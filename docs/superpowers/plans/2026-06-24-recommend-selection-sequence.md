# 推荐牛人 · 配额感知批选 Sequence 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把推荐页主循环从"流式贪心打招呼"改成"配额感知的批选漏斗"：收集足够多 → 排序 → 在「主动查看」额度内开简历打分 → 选分数最高的若干个在「沟通」额度内打招呼；并用真实剩余配额 seed 预算、用 VIP 拦截弹窗做硬兜底。

**Architecture:** 三相漏斗 —— A 相收集+免费规则初筛+排序（不烧配额，列表不虚拟化所以卡始终在 DOM）；B 相对排序后前 `view` 个开简历打分（每次 `openResume` 烧 1 个查看额度）；C 相在打过分的里选分数最高、过阈值的前 `greet` 个，直接点列表卡上的 `btn-greet` 打招呼（不重开简历，两种额度解耦）。起跑读真实剩余配额做预算；任何动作前 `detectState`，命中 `business-block` 拦截弹窗即把对应预算清零、关弹窗、停。native-filter 是另一 agent 的 Layer-0 服务端预筛，本计划只留调用 seam，不实现。

**Tech Stack:** Node ESM `.mjs`（无 TS、无构建）、puppeteer Frame/Page、ghost-cursor、tapable hooks、node:test（`node --test`，零依赖）。代码风格：无分号、单引号、2 空格缩进、printWidth 100。

---

## 关键事实（实现时必须遵守）

- **列表不虚拟化**：滚走的卡仍在 DOM，`frame.$('div.card-inner[data-geek=ID]')` 始终可查询。所以"回到某张卡"= `el.scrollIntoView({block:'center'})`，不需要重建。
- **两种硬性每日配额**：主动查看（免费 20 / VIP 120）= `openResume`；沟通（免费 3 / VIP 60）= 打招呼。
- **真实剩余可读**：账号权益侧栏 → "权益使用量" tab 显示"今日查看权益消耗 X/共Y"、"今日沟通权益消耗 X/共Y"。
- **拦截弹窗权威信号**：额度耗尽点击会弹 `business-block-dialog`（`#boss-dynamic-dialog-<随机>`，body 级，z-index 2002）。class 稳、文案/ID 不稳 → **按 class 判**。
- **权益页 class 是构建哈希**（`usingAmount_xxx` 等会变）→ **按文案锚定**抽数字。
- **卡上 `btn-greet` 可直接打招呼**，不必开简历。
- 风格守则：所有点击走 `cursor.click(handle)`（失败回退 `handle.click()`）；动作间 `sleepWithRandomDelay`；纯函数失败返回值、不抛异常打断循环。

## 文件结构

| 文件 | 职责 | 类型 |
|------|------|------|
| `recommend/pure/state-classifier.mjs` | 加 `business-block` → `QUOTA_BLOCKED` | 改（纯，TDD） |
| `recommend/pure/state-classifier.test.mjs` | 加拦截弹窗用例 | 改 |
| `recommend/pure/quota-parse.mjs` | 解析权益用量文本 → 剩余额度 | 新（纯，TDD） |
| `recommend/pure/quota-parse.test.mjs` | quota-parse 测试 | 新 |
| `recommend/pure/selection.mjs` | `rankForOpen` / `selectForGreet` 批选逻辑 | 新（纯，TDD） |
| `recommend/pure/selection.test.mjs` | selection 测试 | 新 |
| `constant.mjs` | 新选择器/锚点常量 | 改 |
| `recommend/quota-reader.mjs` | 打开权益侧栏、文案锚定抽数字、关闭 | 新（impure，live-smoke） |
| `recommend/actions.mjs` | 加 `scrollCardIntoView` + `greetFromCard` | 改（impure，live-smoke） |
| `recommend/orchestrator.mjs` | 三相批选主循环重写 | 改（wiring，live-smoke） |
| `index.mjs` | `recCfg` 加 `maxViewPerRun` 默认 | 改 |

## 里程碑边界

- **M1（止血，Task 1–4）**：弹窗识别修复 + quota-parse + quota-reader + view 预算闸。可独立合入，先消除"撞墙盲点 + 超烧查看额度"。
- **M2（批选，Task 5–7）**：selection 纯逻辑 + scrollCardIntoView/greetFromCard + orchestrator 三相重写。交付"选最好打招呼"。

---

## Task 1: business-block 拦截弹窗判为 QUOTA_BLOCKED

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/constant.mjs`
- Modify: `packages/boss-auto-browse-and-chat/recommend/pure/state-classifier.mjs`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/state-classifier.test.mjs`

- [ ] **Step 1: 在 state-classifier.test.mjs 加失败用例**

在文件末尾的测试块里追加（与现有 `test(...)` 同风格）：

```js
test('business-block VIP 拦截弹窗判为 QUOTA_BLOCKED（列表 iframe 仍在背后也不误判 LIST）', () => {
  const s = {
    mainText: 'VIP账号 120查看/60沟通 付费即表示同意《BOSS直聘增值服务协议》',
    mainOverlayClasses: [
      'boss-popup__wrapper boss-dialog boss-dialog__wrapper business-block-dialog business-block-wrap circle'
    ],
    frameOverlayClasses: [],
    frameHasList: true,
    verify: false
  }
  assert.equal(classifyState(s), STATES.QUOTA_BLOCKED)
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/state-classifier.test.mjs`
Expected: FAIL —— 该用例返回 `LIST`（命中 `frameHasList`），断言不等于 `QUOTA_BLOCKED`。

- [ ] **Step 3: constant.mjs 加常量**

在 `QUOTA_BLOCKED_TEXT_REGEXP`（约 :98）下方追加：

```js
/** VIP 业务拦截弹窗（额度耗尽点击后弹出）的稳定 class 关键字；ID/文案不稳，按 class 判 */
export const BUSINESS_BLOCK_DIALOG_CLASS_NEEDLE = 'business-block'
/** 业务拦截弹窗的关闭按钮（右上角 X） */
export const BUSINESS_BLOCK_DIALOG_CLOSE_SELECTOR =
  '.business-block-wrap .boss-popup__close, .business-block-dialog .boss-popup__close'
```

- [ ] **Step 4: state-classifier.mjs 加判定**

import 行加入新常量：

```js
import {
  ACCOUNT_BANNED_TEXT_REGEXP,
  QUOTA_BLOCKED_TEXT_REGEXP,
  BUSINESS_BLOCK_DIALOG_CLASS_NEEDLE
} from '../../constant.mjs'
```

在 `if (QUOTA_BLOCKED_TEXT_REGEXP.test(...))` 那一行**之前**插入 class 判定（必须在 `if (s.frameHasList) return STATES.LIST` 之前）：

```js
  if (has(s.mainOverlayClasses, BUSINESS_BLOCK_DIALOG_CLASS_NEEDLE)) return STATES.QUOTA_BLOCKED
  if (QUOTA_BLOCKED_TEXT_REGEXP.test(s.mainText || '')) return STATES.QUOTA_BLOCKED
```

- [ ] **Step 5: 跑测试确认绿（含回归）**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/state-classifier.test.mjs`
Expected: PASS（新用例 + 全部既有用例）。

- [ ] **Step 6: 提交**

```bash
git add packages/boss-auto-browse-and-chat/constant.mjs packages/boss-auto-browse-and-chat/recommend/pure/state-classifier.mjs packages/boss-auto-browse-and-chat/recommend/pure/state-classifier.test.mjs
git commit -m "fix(recommend): detect business-block VIP dialog as QUOTA_BLOCKED"
```

---

## Task 2: quota-parse 纯解析

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/pure/quota-parse.mjs`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/quota-parse.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuotaUsage } from './quota-parse.mjs'

test('解析查看/沟通用量 → used/total/remaining', () => {
  const rows = [
    { name: '今日查看权益消耗', usingText: '7', totalText: '/共20个' },
    { name: '今日沟通权益消耗', usingText: '3', totalText: '/共3个' }
  ]
  const q = parseQuotaUsage(rows)
  assert.deepEqual(q.view, { used: 7, total: 20, remaining: 13 })
  assert.deepEqual(q.greet, { used: 3, total: 3, remaining: 0 })
})

test('剩余不为负', () => {
  const q = parseQuotaUsage([{ name: '今日查看权益消耗', usingText: '25', totalText: '/共20个' }])
  assert.equal(q.view.remaining, 0)
})

test('缺行或脏数据 → null（让调用方回退 cfg）', () => {
  assert.equal(parseQuotaUsage([]).view, null)
  assert.equal(parseQuotaUsage([{ name: '今日查看权益消耗', usingText: '', totalText: '' }]).view, null)
  assert.equal(parseQuotaUsage(null).greet, null)
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/quota-parse.test.mjs`
Expected: FAIL —— `Cannot find module './quota-parse.mjs'`。

- [ ] **Step 3: 实现 quota-parse.mjs**

```js
const firstInt = (s) => {
  const m = String(s ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}
const totalInt = (s) => {
  const m = String(s ?? '').match(/共\s*(\d+)/)
  return m ? Number(m[1]) : null
}

function parseRow (row) {
  if (!row) return null
  const used = firstInt(row.usingText)
  const total = totalInt(row.totalText)
  if (used == null || total == null) return null
  return { used, total, remaining: Math.max(0, total - used) }
}

/**
 * 解析"权益使用量"里查看/沟通两行 → 各自 used/total/remaining；解析不出返回 null。
 * @param {Array<{name:string, usingText:string, totalText:string}>} rows
 * @returns {{view:({used:number,total:number,remaining:number}|null), greet:(object|null)}}
 */
export function parseQuotaUsage (rows) {
  const list = Array.isArray(rows) ? rows : []
  const find = (needle) =>
    list.find((r) => r && typeof r.name === 'string' && r.name.includes(needle))
  return {
    view: parseRow(find('查看')),
    greet: parseRow(find('沟通'))
  }
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/quota-parse.test.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/boss-auto-browse-and-chat/recommend/pure/quota-parse.mjs packages/boss-auto-browse-and-chat/recommend/pure/quota-parse.test.mjs
git commit -m "feat(recommend): add quota usage text parser"
```

---

## Task 3: quota-reader 读真实剩余配额（impure）

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/constant.mjs`
- Create: `packages/boss-auto-browse-and-chat/recommend/quota-reader.mjs`

> 无浏览器无法单测；本任务交付实现 + live-smoke 步骤。解析逻辑已在 Task 2 覆盖。

- [ ] **Step 1: constant.mjs 加锚点**

```js
/** 顶部导航"账号权益"入口（ka 埋点 key 稳，文案兜底） */
export const ACCOUNT_RIGHTS_NAV_SELECTOR = '[ka="header_nav_rights"]'
/** 账号权益侧栏内的 iframe（路径稳，class 哈希不稳） */
export const PRIVILEGE_IFRAME_SELECTOR = 'iframe[src*="/mpa/v3/html/vip/privilege"]'
/** 账号权益侧栏关闭按钮 */
export const PRIVILEGE_PANEL_CLOSE_SELECTOR = '.iframe-box-wrap .iframe-close, .iframe-box-content .iframe-close'
```

- [ ] **Step 2: 实现 quota-reader.mjs**

文案锚定：在 privilege iframe 内找到含"今日查看权益消耗"/"今日沟通权益消耗"文字的卡片，就近取数字与"/共N个"。class 全哈希，故只认中文文案。

```js
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { parseQuotaUsage } from './pure/quota-parse.mjs'
import {
  ACCOUNT_RIGHTS_NAV_SELECTOR,
  PRIVILEGE_IFRAME_SELECTOR,
  PRIVILEGE_PANEL_CLOSE_SELECTOR
} from '../constant.mjs'

/**
 * 在 privilege iframe 内按文案锚定抽两行用量。class 全是构建哈希（usingAmount_xxx 等会变），
 * 只认中文 label。锚"叶子节点"（children.length===0，排除同样 trim 后等于 label 的 cardHeader），
 * 再 closest('li') 只读本卡文字，避免依赖嵌套层数。
 * 实测对应 DOM：li > [cardHeader>span.label] + [cardInfo> span"7" span"个" span"/共20个"]
 *   → li.textContent(折叠空白)="今日查看权益消耗7个/共20个"
 */
function extractQuotaRowsInFrame () {
  const LABELS = ['今日查看权益消耗', '今日沟通权益消耗']
  const leaves = Array.from(document.querySelectorAll('span, p')).filter(
    (el) => el.children.length === 0
  )
  const rows = []
  for (const label of LABELS) {
    const nameEl = leaves.find((el) => el.textContent && el.textContent.trim() === label)
    if (!nameEl) continue
    const card = nameEl.closest('li') || nameEl.parentElement
    const text = (card?.textContent || '').replace(/\s+/g, '') // "今日查看权益消耗7个/共20个"
    const after = text.split(label)[1] || ''
    const usingMatch = after.match(/\d+/) // 7
    const totalMatch = after.match(/共(\d+)/) // 共20
    rows.push({
      name: label,
      usingText: usingMatch ? usingMatch[0] : '',
      totalText: totalMatch ? totalMatch[0] : ''
    })
  }
  return rows
}

/**
 * 打开账号权益侧栏 → 权益使用量 → 读真实剩余 → 关侧栏。
 * 失败一律返回 null（调用方回退 cfg 预算，绝不因读不到而中断运行）。
 * @param {import('puppeteer').Page} page
 * @returns {Promise<{view:object|null, greet:object|null}|null>}
 */
export async function readQuota (page) {
  try {
    const nav = await page.$(ACCOUNT_RIGHTS_NAV_SELECTOR)
    if (!nav) return null
    await nav.click().catch(() => {})
    // 等 privilege iframe 出现并拿到其 frame
    let frame = null
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const el = await page.$(PRIVILEGE_IFRAME_SELECTOR).catch(() => null)
      if (el) {
        frame = await el.contentFrame().catch(() => null)
        if (frame) break
      }
      await sleep(300)
    }
    if (!frame) {
      await closePanel(page)
      return null
    }
    // 切到"权益使用量"tab（按文案）
    await frame
      .evaluate(() => {
        const tab = Array.from(document.querySelectorAll('li, a, span, div')).find(
          (el) => el.textContent && el.textContent.trim() === '权益使用量'
        )
        if (tab) tab.click()
      })
      .catch(() => {})
    await sleep(800)
    const rows = await frame.evaluate(extractQuotaRowsInFrame).catch(() => [])
    await closePanel(page)
    const q = parseQuotaUsage(rows)
    return q.view || q.greet ? q : null
  } catch {
    await closePanel(page).catch(() => {})
    return null
  }
}

async function closePanel (page) {
  const btn = await page.$(PRIVILEGE_PANEL_CLOSE_SELECTOR).catch(() => null)
  if (btn) await btn.click().catch(() => {})
  await sleep(400)
}
```

- [ ] **Step 3: 接 worker 调试命令（live-smoke 用，可选但推荐）**

参照 native-filter agent 在 `BOSS_RECOMMEND_DEBUG_MAIN` 加的 `diagnose-filter` 命令，加一个一次性命令 `read-quota`：登录后调 `readQuota(page)` 打印结果，不跑整轮。位置：`packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts`（按该文件现有命令分支风格新增一条 case）。

- [ ] **Step 4: LIVE-SMOKE（真账号，只读不操作）**

在 dev 浏览器登录后触发 `read-quota`，确认打印形如 `{ view:{used,total,remaining}, greet:{...} }` 且数字与页面"权益使用量"一致；确认侧栏被关回、页面回到推荐列表。**只读，不烧任何配额。**

- [ ] **Step 5: 提交**

```bash
git add packages/boss-auto-browse-and-chat/constant.mjs packages/boss-auto-browse-and-chat/recommend/quota-reader.mjs packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts
git commit -m "feat(recommend): read live remaining view/greet quota from account rights panel"
```

---

## Task 4: view 预算闸（M1 收尾，先在现有结构上止血）

> 本任务在**现有流式 orchestrator** 上加最小改动：seed 真实预算 + `openResume` 前查 `view` 预算 + 命中 `QUOTA_BLOCKED` 时关弹窗并清零。让 M1 可独立合入。Task 6 会把结构换成批选；此处的预算字段/守卫会被 Task 6 复用。

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/index.mjs`
- Modify: `packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs`

- [ ] **Step 1: index.mjs 加 `maxViewPerRun` 默认**

在 `recCfg` 对象（:421 起）里 `maxGreetPerRun` 行下方加：

```js
      maxViewPerRun: recommendPageOpts.maxViewPerRun ?? 20,
```

- [ ] **Step 2: orchestrator 顶部 seed 预算 + import**

`orchestrator.mjs` import 区加：

```js
import { readQuota } from './quota-reader.mjs'
import { BUSINESS_BLOCK_DIALOG_CLOSE_SELECTOR } from '../constant.mjs'
```

把 `const budgets = {...}`（:29）替换为读真实剩余后 seed（读不到回退 cfg）：

```js
  const q = await readQuota(page).catch(() => null)
  const budgets = {
    greet: q?.greet?.remaining ?? cfg.maxGreetPerRun,
    view: q?.view?.remaining ?? cfg.maxViewPerRun ?? 20,
    x: cfg.maxXPerRun,
    scroll: cfg.maxScrollSteps
  }
  if (budgets.greet <= 0 && budgets.view <= 0) return
```

- [ ] **Step 3: openResume 前加 view 闸 + 成功后递减**

在 `if (budgets.greet <= 0) {...continue}` 块之后、`openResume` 之前加：

```js
      // 「主动查看」额度耗尽：开简历会烧查看配额且触发拦截弹窗，直接跳过
      if (budgets.view <= 0) {
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }
```

把 `if (!await openResume(...)) {...}` 块改为：开成功即 `budgets.view--`，开失败时探测是否撞拦截弹窗：

```js
      if (!await openResume(page, frame, cursor, c.encryptGeekId)) {
        // 开简历失败可能是查看额度耗尽弹出 business-block；探测并清零
        if ((await detectState(page, frame)) === STATES.QUOTA_BLOCKED) {
          await closeBusinessBlock(page)
          budgets.view = 0
        }
        seen.add(c.encryptGeekId)
        newCount++
        continue
      }
      budgets.view--
```

- [ ] **Step 4: 加 closeBusinessBlock 辅助 + 循环级清零**

在 orchestrator 文件底部加：

```js
async function closeBusinessBlock (page) {
  const btn = await page.$(BUSINESS_BLOCK_DIALOG_CLOSE_SELECTOR).catch(() => null)
  if (btn) await btn.click().catch(() => {})
}
```

并在主循环 `if (st === STATES.QUOTA_BLOCKED) break`（:49）改为关弹窗后再 break：

```js
    if (st === STATES.QUOTA_BLOCKED) {
      await closeBusinessBlock(page)
      break
    }
```

- [ ] **Step 5: 跑全包测试确认无回归**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat test`
Expected: PASS（纯逻辑测试不受 impure 改动影响；确认无 import 错误）。

- [ ] **Step 6: LIVE-SMOKE（真账号，谨慎）**

dev 浏览器跑一轮，确认：起跑日志打印 seed 后的 `view/greet` 预算；查看额度用尽后不再开新简历；若中途撞拦截弹窗，弹窗被关、循环干净退出（不再盲点）。**用低 `maxViewPerRun`（如 2）控制消耗。**

- [ ] **Step 7: 提交（M1 完成）**

```bash
git add packages/boss-auto-browse-and-chat/index.mjs packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs
git commit -m "feat(recommend): seed budgets from live quota + view-budget gate + close block dialog"
```

---

## Task 5: 批选纯逻辑 + 卡级原语（M2 起）

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/pure/selection.mjs`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/selection.test.mjs`
- Modify: `packages/boss-auto-browse-and-chat/recommend/actions.mjs`
- Modify: `packages/boss-auto-browse-and-chat/constant.mjs`

- [ ] **Step 1: 写 selection 失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankForOpen, selectForGreet } from './selection.mjs'

const pre = (c) => c.s // 测试用预排序函数

test('rankForOpen：best-first 排序并截取 viewBudget', () => {
  const pool = [{ id: 'a', s: 1 }, { id: 'b', s: 3 }, { id: 'c', s: 2 }]
  const r = rankForOpen(pool, pre, 2)
  assert.deepEqual(r.map((x) => x.id), ['b', 'c'])
})

test('rankForOpen：viewBudget<=0 → 空', () => {
  assert.deepEqual(rankForOpen([{ id: 'a', s: 1 }], pre, 0), [])
})

test('selectForGreet：去 hardReject + 过阈值 + 按分降序 + 截 greetBudget', () => {
  const scored = [
    { candidate: { id: 'a' }, score: 90, hardReject: false },
    { candidate: { id: 'b' }, score: 95, hardReject: true },
    { candidate: { id: 'c' }, score: 80, hardReject: false },
    { candidate: { id: 'd' }, score: 50, hardReject: false }
  ]
  const r = selectForGreet(scored, { minScore: 60, greetBudget: 2 })
  assert.deepEqual(r.map((x) => x.candidate.id), ['a', 'c'])
})

test('selectForGreet：greetBudget<=0 → 空', () => {
  assert.deepEqual(selectForGreet([{ candidate: {}, score: 99, hardReject: false }], { minScore: 0, greetBudget: 0 }), [])
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/selection.test.mjs`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 selection.mjs**

```js
/**
 * 按预排序分数 best-first 排序，截取前 viewBudget 个作为"开简历集"。
 * @param {Array<object>} pool
 * @param {(c:object)=>number} prescore
 * @param {number} viewBudget
 */
export function rankForOpen (pool, prescore, viewBudget) {
  if (!Array.isArray(pool) || viewBudget <= 0) return []
  return [...pool].sort((a, b) => prescore(b) - prescore(a)).slice(0, viewBudget)
}

/**
 * 从已打分集合选"打招呼集"：去 hardReject、过阈值、按分降序、截 greetBudget。
 * @param {Array<{candidate:object,score:number,hardReject?:boolean}>} scored
 * @param {{minScore?:number, greetBudget?:number}} opts
 */
export function selectForGreet (scored, { minScore = 0, greetBudget = 0 } = {}) {
  if (!Array.isArray(scored) || greetBudget <= 0) return []
  return scored
    .filter((s) => s && !s.hardReject && typeof s.score === 'number' && s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, greetBudget)
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat exec node --test recommend/pure/selection.test.mjs`
Expected: PASS。

- [ ] **Step 5: constant.mjs 加卡级打招呼按钮选择器说明**

```js
/** 列表卡内的打招呼按钮（在 li.card-item 作用域内查询，不开简历直接招呼） */
export const CARD_GREET_BTN_SELECTOR = 'button.btn-greet'
```

- [ ] **Step 6: actions.mjs 加 scrollCardIntoView + greetFromCard**

import 区加：

```js
import { CARD_GREET_BTN_SELECTOR } from '../constant.mjs'
import { GREETING_SENT_KNOW_BTN_SELECTOR } from '../constant.mjs'
import { detectState, STATES } from './page-state.mjs'
```
（`GREETING_SENT_KNOW_BTN_SELECTOR` = `div.dialog-wrap button.btn-sure-v2`，constant.mjs:33 已有）

文件追加：

```js
/** 把已在 DOM 的目标卡滚进视口中部（列表不虚拟化，卡始终可查询）。返回是否找到。 */
export async function scrollCardIntoView (frame, encryptGeekId) {
  if (!frame) return false
  const ok = await frame
    .evaluate((id) => {
      const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
      if (!inner) return false
      inner.scrollIntoView({ block: 'center', inline: 'nearest' })
      return true
    }, encryptGeekId)
    .catch(() => false)
  if (ok) await sleep(400)
  return ok
}

/**
 * 在列表卡上直接点"打招呼"（不开简历）。
 * 返回 { greeted, quotaBlocked }：撞 business-block 时 greeted=false, quotaBlocked=true。
 */
export async function greetFromCard (page, frame, cursor, encryptGeekId) {
  const handle = await frame.evaluateHandle((id, sel) => {
    const inner = document.querySelector(`div.card-inner[data-geek="${id}"]`)
    if (!inner) return null
    const li = inner.closest('li.card-item')
    return li ? li.querySelector(sel) : null
  }, encryptGeekId, CARD_GREET_BTN_SELECTOR)
  const btn = handle.asElement()
  if (!btn) return { greeted: false, quotaBlocked: false }
  await cursor.click(btn).catch(async () => {
    await btn.click().catch(() => {})
  })
  await sleep(800)
  // 点击后可能：① 弹 business-block（额度耗尽）② 弹"招呼已送达"确认 ③ 直接成功
  if ((await detectState(page, frame)) === STATES.QUOTA_BLOCKED) {
    return { greeted: false, quotaBlocked: true }
  }
  const know = await page.$(GREETING_SENT_KNOW_BTN_SELECTOR).catch(() => null)
  if (know) {
    await cursor.click(know).catch(async () => {
      await know.click().catch(() => {})
    })
  }
  return { greeted: true, quotaBlocked: false }
}
```

- [ ] **Step 7: 跑全包测试确认无回归**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat test`
Expected: PASS。

- [ ] **Step 8: LIVE-SMOKE（真账号，最多 1–2 次打招呼）**

dev 浏览器：对一张已滚出视口的卡调 `scrollCardIntoView` 确认滚入视口；对 1 个候选人调 `greetFromCard`，确认招呼发出（沟通计数 -1）、确认弹窗被关；故意在额度耗尽时再调一次，确认返回 `{quotaBlocked:true}`。**确认卡级 `btn-greet` 在推荐页确实可用；若不可用，改用回退（重开 `has-viewed` 卡的模态 `greetInModal`，并先确认重开不再扣查看）。**

- [ ] **Step 9: 提交**

```bash
git add packages/boss-auto-browse-and-chat/recommend/pure/selection.mjs packages/boss-auto-browse-and-chat/recommend/pure/selection.test.mjs packages/boss-auto-browse-and-chat/recommend/actions.mjs packages/boss-auto-browse-and-chat/constant.mjs
git commit -m "feat(recommend): add batch selection logic + scrollCardIntoView + greetFromCard"
```

---

## Task 6: orchestrator 三相批选重写

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs`

> 把 Task 4 改过的流式循环整体替换为三相批选。预算 seed/closeBusinessBlock 沿用 Task 4。无浏览器无法单测主循环；纯逻辑已被 Task 5 覆盖，本任务靠 live-smoke。

- [ ] **Step 1: 重写 runRecommendLoop 为三相**

完整替换 `runRecommendLoop` 函数体（保留 import；新增对 `rankForOpen/selectForGreet/scrollCardIntoView/greetFromCard` 的 import）：

```js
import { rankForOpen, selectForGreet } from './pure/selection.mjs'
import { rejectFromList, scrollGently, scrollCardIntoView, greetFromCard } from './actions.mjs'
```

```js
export async function runRecommendLoop (page, getFrame, hooks, cfg, llmFn) {
  const cursor = await createHumanCursor(page)
  const q = await readQuota(page).catch(() => null)
  const budgets = {
    greet: q?.greet?.remaining ?? cfg.maxGreetPerRun,
    view: q?.view?.remaining ?? cfg.maxViewPerRun ?? 20,
    x: cfg.maxXPerRun
  }
  if (budgets.greet <= 0 && budgets.view <= 0) return

  // ---------- 状态守卫：返回 'list' | 'break' | 'retry' ----------
  let stuckHeals = 0
  async function guard (frame) {
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
        if (budgets.x > 0 && shouldClickX(cfg) && c.interactable) {
          if (await rejectFromList(page, frame, cursor, c.encryptGeekId, pre.reason, c)) budgets.x--
        }
        continue
      }
      pool.set(c.encryptGeekId, c)
    }
    staleScrolls = pool.size === before ? staleScrolls + 1 : 0
    if (pool.size >= target || staleScrolls >= cfg.maxStaleWaves) break
    await scrollGently(page, cfg)
  }

  const openSet = rankForOpen([...pool.values()], cheapPrescore, budgets.view)

  // ---------- B 相：开简历 + 打分（烧查看额度） ----------
  const scored = []
  for (const c of openSet) {
    if (budgets.view <= 0) break
    const frame = getFrame()
    const g = await guard(frame)
    if (g === 'break') break
    if (g === 'retry') continue
    await scrollCardIntoView(frame, c.encryptGeekId)
    if (!await openResume(page, frame, cursor, c.encryptGeekId)) {
      if ((await detectState(page, frame)) === STATES.QUOTA_BLOCKED) {
        await closeBusinessBlock(page)
        budgets.view = 0
      }
      continue
    }
    budgets.view--
    if (!await assertIdentity(frame, c.geekName)) {
      await closeResume(page, frame, cursor)
      continue
    }
    const resume = await readSummary(frame)
    const s = await score(c, resume, cfg, llmFn)
    scored.push({ candidate: c, score: s.score, hardReject: s.hardReject, reason: s.reason })
    await closeResume(page, frame, cursor)
    if (s.hardReject && budgets.x > 0 && shouldClickX(cfg)) {
      if (await rejectFromList(page, frame, cursor, c.encryptGeekId, s.reason, c)) budgets.x--
    }
    await sleepWithRandomDelay(
      cfg.delayBetweenActionsMs?.[0] ?? 1500,
      cfg.delayBetweenActionsMs?.[1] ?? 4000
    )
  }

  // ---------- C 相：选最好 + 打招呼（烧沟通额度） ----------
  const greetSet = selectForGreet(scored, { minScore: cfg.minScoreToChat, greetBudget: budgets.greet })
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
```

- [ ] **Step 2: 确认 import 完整、跑全包测试**

Run: `pnpm -F @geekgeekrun/boss-auto-browse-and-chat test`
Expected: PASS（无 import/语法错误；纯逻辑测试全绿）。

- [ ] **Step 3: lint**

Run: `pnpm -F geekgeekrun-ui lint`（确认风格：无分号/单引号）。如 boss-auto-browse 不在 ui lint 范围内，目视核对风格。
Expected: 无新增报错。

- [ ] **Step 4: LIVE-SMOKE（真账号，端到端，最小消耗）**

dev 浏览器配 `maxViewPerRun:3`、低 `maxGreetPerRun`，跑完整一轮，确认顺序：起跑读配额 → A 相滚动收集并对硬拒点 X → B 相对前 3 个开简历打分（查看 -3）→ C 相在打分者里挑最高分打招呼（沟通对应递减）→ 额度耗尽或弹窗时干净结束。核对计数器与页面"权益使用量"一致。

- [ ] **Step 5: 提交（M2 完成）**

```bash
git add packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs
git commit -m "feat(recommend): rewrite loop into collect-rank-open-select-greet batch funnel"
```

---

## Task 7: native-filter 调用 seam（与另一 agent 合并后接线）

> 仅在 `feat/recommend-native-filter` 合入本分支后做。本任务把 Layer-0 预筛挂到 A 相之前。

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs`

- [ ] **Step 1: A 相循环之前调用一次 applyNativeFilter**

合并后 import 其原语，在 `readQuota` 之后、A 相 `while` 之前：

```js
import { planNativeFilter } from './pure/native-filter.mjs'
import { applyNativeFilter } from './native-filter-driver.mjs'
// ...
if (cfg.nativeFilter?.enabled) {
  const plan = planNativeFilter(cfg.nativeFilter)
  const report = await applyNativeFilter(page, getFrame(), cursor, plan).catch(() => null)
  if (report?.listEmptyAfterApply) {
    console.warn('[recommend] 原生筛选后列表为空，本轮无人可处理')
    return
  }
}
```

- [ ] **Step 2: 确认 cfg.nativeFilter 透传**

确认 `index.mjs` 的 `recCfg` 含 `nativeFilter`（来自 `candidateFilter.nativeFilter` 或 per-job）。若缺，在 `recCfg` 加 `nativeFilter: filterConfig.nativeFilter`。

- [ ] **Step 3: LIVE-SMOKE + 提交**

确认启用 nativeFilter 后列表确实变化、A 相在已预筛的列表上收集。提交：

```bash
git commit -am "feat(recommend): wire native-filter as Layer-0 before collect phase"
```

---

## Self-Review

- **Spec 覆盖**：弹窗自适应（T1）、真实配额读取（T2/T3）、view 预算（T4）、批选"看多→排序→开够→选最好打招呼"（T5/T6）、native-filter seam（T7）—— 与对话中确定的设计逐条对应。
- **类型/命名一致**：`budgets.{greet,view,x}` 全程一致；`scored` 元素形状 `{candidate,score,hardReject,reason}` 在 T5 测试、T6 B 相产出、C 相 `selectForGreet` 消费三处一致；`greetFromCard` 返回 `{greeted,quotaBlocked}` 在 T5 定义、T6 C 相消费一致；`readQuota` 返回 `{view,greet}` 在 T2/T3/T4/T6 一致。
- **无占位符**：纯逻辑任务含完整测试+实现代码；impure 任务含完整实现代码 + 明确 live-smoke 验证步骤。
- **风险**：所有真机步骤标注最小消耗（低 `maxViewPerRun`、1–2 次打招呼）；T5 Step 8 给出卡级 `btn-greet` 不可用时的回退路径；读配额/筛选失败一律回退、不中断。

## 真机部分要确认什么（区分"已验证"与"只能真机验"）

**已对着实际 HTML 验证、不是假设：**
- quota-parse 解析（T2，纯逻辑全覆盖）。
- quota-reader 的**抽取逻辑** `extractQuotaRowsInFrame`：已对用户给的权益用量 DOM 逐节点 trace（叶子 label 锚 + `closest('li')` 读本卡 → `今日查看权益消耗7个/共20个` → used=7/total=20）。当前 DOM 下确定能抽出。
- `business-block` 弹窗按 class 判（T1，已对用户给的弹窗 HTML 确认 `business-block-dialog`/`business-block-wrap` 在 `mainOverlayClasses`）。

**只能真机验（静态 HTML 看不出的导航/交互/计费行为）：**
1. `readQuota` 的**导航链**：点 `[ka="header_nav_rights"]` → privilege iframe 加载 → 点"权益使用量"tab → 侧栏能关回列表（T3 Step 4）。抽取本身已验证，要验的是这串点击/加载时序。
2. 列表卡 `button.btn-greet` 在推荐页**可点即发招呼**（T5 Step 8）。不成立 → C 相回退模态 `greetInModal` + 确认重开 `has-viewed` 卡不再扣查看。
3. `openResume`/打招呼**确实各扣对应配额**、计数器与页面一致（T4/T6 live-smoke）。

> 维护提示：BOSS 改版**中文 label 文案**时，更新 `extractQuotaRowsInFrame` 的 `LABELS` 与 `parseQuotaUsage` 的 `find('查看'/'沟通')`。这是文案锚定的唯一脆弱点，不是当前正确性问题。
