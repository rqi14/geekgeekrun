# 推荐牛人自动化 · 配置 Tab UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个流程对齐的 4-Tab 配置页(`RecommendAutomation`)取代散落的招聘端推荐牛人配置；新页只读写现有配置文件、复用现有 IPC，附三处小而安全的后端补丁，增量可回退。

**Architecture:** 见 `docs/superpowers/specs/2026-06-12-recommend-config-tab-ui-design.md`(已含 codex 评审修正)。后端补丁走 TDD(node:test/.mjs)；UI 映射逻辑抽成可测 `.mjs`;Vue 组件靠 typecheck+build 验证。

**Tech Stack:** Electron + Vue 3 `<script setup>` + TS + element-plus ^2.8.4 + UnoCSS;node:test(零新依赖)。

测试命令(后端+映射)：`cd packages/boss-auto-browse-and-chat && node --test recommend/pure/*.test.mjs`
UI 映射测试：`cd packages/ui && node --test src/renderer/src/page/MainLayout/RecommendAutomation/*.test.mjs`
类型：`pnpm -F geekgeekrun-ui typecheck`  构建：`pnpm -F geekgeekrun-ui build`

代码风格：无分号、单引号、printWidth 100、无尾逗号(automation .mjs);UI 区遵循 eslint+prettier。

---

## File Structure

**后端补丁(packages/boss-auto-browse-and-chat):**
- Modify: `runtime-file-utils.mjs:165` — `jobFilterToCandidateFilter` 透传所有 filter 键
- Create: `recommend/pure/job-filter-passthrough.test.mjs` — 上面的单测(导入 runtime-file-utils 的导出)
- Modify: `recommend/orchestrator.mjs:62-105` — `clickNotInterestedForFiltered` 守卫
- Create: `recommend/pure/x-guard.test.mjs` — 守卫纯逻辑单测(抽 `shouldClickX(cfg)` 纯函数)
- Create: `recommend/pure/x-guard.mjs` — `export function shouldClickX(cfg)`

**UI 映射逻辑(可测):**
- Create: `packages/ui/src/renderer/src/page/MainLayout/RecommendAutomation/mapping.mjs` — `normalizeRecommendConfig(raw)` + `toSavePayload(state)` 纯函数
- Create: `.../RecommendAutomation/mapping.d.ts` — 给 TS 用的类型声明
- Create: `.../RecommendAutomation/mapping.test.mjs` — node:test

**UI 组件:**
- Create: `.../RecommendAutomation/index.vue` — 外壳 + 装载/保存/运行 + sequence 守卫
- Create: `.../RecommendAutomation/useRecommendConfig.ts` — composable 包装 mapping + IPC
- Create: `.../RecommendAutomation/FilterRuleRow.vue`
- Create: `.../RecommendAutomation/ScoringTab.vue`
- Create: `.../RecommendAutomation/CardFilterTab.vue`
- Create: `.../RecommendAutomation/BudgetTab.vue`
- Create: `.../RecommendAutomation/RunTab.vue`

**接线 & 后端 IPC:**
- Modify: `packages/ui/src/renderer/src/router/index.ts` — 注册路由 `RecommendAutomation`
- Modify: `packages/ui/src/renderer/src/page/MainLayout/LeftNavBar/RecruiterPart.vue` — 新增入口(主)
- Modify: `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts:954` — save 透传 school/major/scoring;并在 `fetch-...` 附带 sequence 检测(或新增轻 IPC `fetch-boss-jobs-config` 已存在，前端直接用)

---

## Task 1: jobFilterToCandidateFilter 透传所有 filter 键

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs:165-200`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/job-filter-passthrough.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __jobFilterToCandidateFilter } from '../../runtime-file-utils.mjs'

test('passes through skills/school/major/blockName/skipViewed', () => {
  const out = __jobFilterToCandidateFilter({
    expectSkillKeywords: ['LC-MS'],
    expectSchoolKeywords: ['双一流'],
    expectMajorKeywords: ['食品'],
    blockCandidateNameRegExpStr: '^张',
    skipViewedCandidates: true
  })
  assert.deepEqual(out.expectSkillKeywords, ['LC-MS'])
  assert.deepEqual(out.expectSchoolKeywords, ['双一流'])
  assert.deepEqual(out.expectMajorKeywords, ['食品'])
  assert.equal(out.blockCandidateNameRegExpStr, '^张')
  assert.equal(out.skipViewedCandidates, true)
})
test('defaults are empty when fields absent', () => {
  const out = __jobFilterToCandidateFilter({})
  assert.deepEqual(out.expectSkillKeywords, [])
  assert.deepEqual(out.expectSchoolKeywords, [])
  assert.deepEqual(out.expectMajorKeywords, [])
  assert.equal(out.blockCandidateNameRegExpStr, '')
  assert.equal(out.skipViewedCandidates, false)
})
```

- [ ] **Step 2: 运行确认失败**（`__jobFilterToCandidateFilter` 未导出 + 字段缺失）
Run: `node --test recommend/pure/job-filter-passthrough.test.mjs` → FAIL

- [ ] **Step 3: 实现**：把函数内 `return {...}` 的硬编码替换为透传，并 `export` 一个测试别名。

```js
  return {
    expectCityList,
    expectEducationRegExpStr,
    expectWorkExpRange,
    expectSalaryRange,
    expectSalaryWhenNegotiable: f.expectSalaryWhenNegotiable || 'exclude',
    expectSkillKeywords: Array.isArray(f.expectSkillKeywords) ? f.expectSkillKeywords : [],
    expectSchoolKeywords: Array.isArray(f.expectSchoolKeywords) ? f.expectSchoolKeywords : [],
    expectMajorKeywords: Array.isArray(f.expectMajorKeywords) ? f.expectMajorKeywords : [],
    blockCandidateNameRegExpStr:
      typeof f.blockCandidateNameRegExpStr === 'string' ? f.blockCandidateNameRegExpStr : '',
    skipViewedCandidates: f.skipViewedCandidates === true
  }
```
并在文件末尾(或函数定义处)追加：`export const __jobFilterToCandidateFilter = jobFilterToCandidateFilter`

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: Commit** `fix(recommend): jobFilterToCandidateFilter passes through all filter keys`

---

## Task 2: orchestrator clickNotInterestedForFiltered 守卫

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/pure/x-guard.mjs`
- Test: `packages/boss-auto-browse-and-chat/recommend/pure/x-guard.test.mjs`
- Modify: `packages/boss-auto-browse-and-chat/recommend/orchestrator.mjs`

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldClickX } from './x-guard.mjs'

test('default (undefined) → click X allowed', () => { assert.equal(shouldClickX({}), true) })
test('explicit false → suppressed', () => { assert.equal(shouldClickX({ clickNotInterestedForFiltered: false }), false) })
test('explicit true → allowed', () => { assert.equal(shouldClickX({ clickNotInterestedForFiltered: true }), true) })
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 实现** `x-guard.mjs`：

```js
/** 是否对被筛掉的候选人点"不感兴趣"(X)。仅在显式设为 false 时抑制。 */
export function shouldClickX (cfg) {
  return cfg?.clickNotInterestedForFiltered !== false
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 接进 orchestrator**：`import { shouldClickX } from './x-guard.mjs'`,在两处 `rejectFromList` 外层包守卫：

Stage A(列表初筛 reject，`orchestrator.mjs:68` 附近)：
```js
        if (budgets.x > 0 && shouldClickX(cfg)) {
          if (await rejectFromList(page, frame, cursor, c.encryptGeekId, pre.reason)) budgets.x--
        }
```
Stage C(hardReject，`orchestrator.mjs:93` 附近)同样加 `&& shouldClickX(cfg)`。

- [ ] **Step 6: 跑全 pure 套件确认无回归** `node --test recommend/pure/*.test.mjs` → all pass
- [ ] **Step 7: Commit** `feat(recommend): honor clickNotInterestedForFiltered in wave loop`

---

## Task 3: UI 配置映射纯函数(可测 .mjs)

**Files:**
- Create: `packages/ui/src/renderer/src/page/MainLayout/RecommendAutomation/mapping.mjs`
- Create: `.../RecommendAutomation/mapping.d.ts`
- Test: `.../RecommendAutomation/mapping.test.mjs`

映射契约见设计 §2/§6。`normalizeRecommendConfig(raw)` 把两个 JSON + 默认值归一为统一 state;`toSavePayload(state)` 拆回 `save-boss-recruiter-config` 的扁平 payload。

- [ ] **Step 1: 写失败测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecommendConfig, toSavePayload, DEFAULTS } from './mapping.mjs'

test('fills defaults when configs empty', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  assert.equal(s.budget.maxGreetPerRun, DEFAULTS.maxGreetPerRun)
  assert.equal(s.budget.maxScrollSteps, DEFAULTS.maxScrollSteps)
  assert.equal(s.scoring.enabled, false)
  assert.equal(s.scoring.onScoreError, 'skip')
  assert.deepEqual(s.filter.expectSchoolKeywords, [])
})
test('reads existing values', () => {
  const s = normalizeRecommendConfig({
    'boss-recruiter.json': { recommendPage: { maxGreetPerRun: 3, maxXPerRun: 5 }, scoring: { enabled: true, jd: 'x', minScoreToChat: 70 } },
    'candidate-filter.json': { expectSchoolKeywords: ['双一流'], expectSalaryRange: [10, 20] }
  })
  assert.equal(s.budget.maxGreetPerRun, 3)
  assert.equal(s.scoring.enabled, true)
  assert.equal(s.scoring.minScoreToChat, 70)
  assert.deepEqual(s.filter.expectSchoolKeywords, ['双一流'])
})
test('toSavePayload round-trips key names the IPC + orchestrator expect', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': {} })
  s.filter.expectSchoolKeywords = ['QS']
  s.filter.expectMajorKeywords = ['食品']
  s.scoring.enabled = true
  s.scoring.jd = 'JD here'
  s.budget.maxGreetPerRun = 2
  const p = toSavePayload(s)
  // candidate-filter keys flat on payload (matches save-boss-recruiter-config handler)
  assert.deepEqual(p.expectSchoolKeywords, ['QS'])
  assert.deepEqual(p.expectMajorKeywords, ['食品'])
  // scoring nested → boss-recruiter.json
  assert.equal(p.scoring.enabled, true)
  assert.equal(p.scoring.jd, 'JD here')
  // budget under recommendPage
  assert.equal(p.recommendPage.maxGreetPerRun, 2)
})
test('clamps ranges (min<=max, non-negative)', () => {
  const s = normalizeRecommendConfig({ 'boss-recruiter.json': {}, 'candidate-filter.json': { expectSalaryRange: [30, 10] } })
  assert.ok(s.filter.expectSalaryRange[0] <= s.filter.expectSalaryRange[1])
})
```

- [ ] **Step 2: 运行确认失败** → FAIL
- [ ] **Step 3: 实现 `mapping.mjs`**(完整默认值 + 双向映射;键名严格对齐设计 §2 与 IPC handler 的扁平 payload)。结构：

```js
export const DEFAULTS = {
  waveSize: 6, maxGreetPerRun: 10, maxXPerRun: 10, maxScrollSteps: 6, maxStaleWaves: 2,
  scrollDelayMsRange: [800, 2000], delayBetweenActionsMs: [1500, 4000],
  minScoreToChat: 0, onScoreError: 'skip'
}
const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v, d) => (typeof v === 'number' && !Number.isNaN(v) ? v : d)
const sortedRange = (v, d) => { const a = Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : [...d]; return a[0] <= a[1] ? a : [a[1], a[0]] }

export function normalizeRecommendConfig (raw) {
  const r = raw?.['boss-recruiter.json'] || {}
  const f = raw?.['candidate-filter.json'] || {}
  const rp = r.recommendPage || {}
  const sc = r.scoring || {}
  return {
    scoring: {
      enabled: sc.enabled === true,
      jd: typeof sc.jd === 'string' ? sc.jd : '',
      minScoreToChat: num(sc.minScoreToChat, DEFAULTS.minScoreToChat),
      onScoreError: sc.onScoreError === 'greetIfRulePass' ? 'greetIfRulePass' : 'skip',
      modelId: sc.modelId ?? null
    },
    filter: {
      expectCityList: arr(f.expectCityList),
      expectEducationRegExpStr: typeof f.expectEducationRegExpStr === 'string' ? f.expectEducationRegExpStr : '',
      expectWorkExpRange: sortedRange(f.expectWorkExpRange, [0, 99]),
      expectSalaryRange: sortedRange(f.expectSalaryRange, [0, 0]),
      expectSalaryWhenNegotiable: f.expectSalaryWhenNegotiable === 'include' ? 'include' : 'exclude',
      expectSkillKeywords: arr(f.expectSkillKeywords),
      expectSchoolKeywords: arr(f.expectSchoolKeywords),
      expectMajorKeywords: arr(f.expectMajorKeywords),
      blockCandidateNameRegExpStr: typeof f.blockCandidateNameRegExpStr === 'string' ? f.blockCandidateNameRegExpStr : '',
      skipViewedCandidates: (rp.skipViewedCandidates ?? f.skipViewedCandidates) === true
    },
    budget: {
      waveSize: num(rp.waveSize, DEFAULTS.waveSize),
      maxGreetPerRun: num(rp.maxGreetPerRun, DEFAULTS.maxGreetPerRun),
      maxXPerRun: num(rp.maxXPerRun, DEFAULTS.maxXPerRun),
      maxScrollSteps: num(rp.maxScrollSteps, DEFAULTS.maxScrollSteps),
      maxStaleWaves: num(rp.maxStaleWaves, DEFAULTS.maxStaleWaves),
      scrollDelayMsRange: sortedRange(rp.scrollDelayMsRange, DEFAULTS.scrollDelayMsRange),
      delayBetweenActionsMs: sortedRange(rp.delayBetweenActionsMs, DEFAULTS.delayBetweenActionsMs),
      greetingMessage: typeof r.autoChat?.greetingMessage === 'string' ? r.autoChat.greetingMessage : '',
      maxChatPerRun: num(r.autoChat?.maxChatPerRun, 50)
    },
    run: {
      clickNotInterestedForFiltered: rp.clickNotInterestedForFiltered !== false,
      runOnceAfterComplete: rp.runOnceAfterComplete === true,
      rerunIntervalMs: num(rp.rerunIntervalMs, 600000),
      keepBrowserOpenAfterRun: rp.keepBrowserOpenAfterRun === true,
      persistProfile: r.advanced?.persistProfile === true
    }
  }
}

export function toSavePayload (s) {
  return {
    // candidate-filter.json（IPC handler 读扁平键）
    expectCityList: s.filter.expectCityList,
    expectEducationRegExpStr: s.filter.expectEducationRegExpStr,
    expectWorkExpRange: s.filter.expectWorkExpRange,
    expectSalaryRange: s.filter.expectSalaryRange,
    expectSalaryWhenNegotiable: s.filter.expectSalaryWhenNegotiable,
    expectSkillKeywords: s.filter.expectSkillKeywords,
    expectSchoolKeywords: s.filter.expectSchoolKeywords,
    expectMajorKeywords: s.filter.expectMajorKeywords,
    blockCandidateNameRegExpStr: s.filter.blockCandidateNameRegExpStr,
    skipViewedCandidates: s.filter.skipViewedCandidates,
    // boss-recruiter.json
    scoring: { ...s.scoring },
    autoChat: { greetingMessage: s.budget.greetingMessage, maxChatPerRun: s.budget.maxChatPerRun },
    advanced: { persistProfile: s.run.persistProfile },
    recommendPage: {
      waveSize: s.budget.waveSize, maxGreetPerRun: s.budget.maxGreetPerRun, maxXPerRun: s.budget.maxXPerRun,
      maxScrollSteps: s.budget.maxScrollSteps, maxStaleWaves: s.budget.maxStaleWaves,
      scrollDelayMsRange: s.budget.scrollDelayMsRange, delayBetweenActionsMs: s.budget.delayBetweenActionsMs,
      clickNotInterestedForFiltered: s.run.clickNotInterestedForFiltered,
      runOnceAfterComplete: s.run.runOnceAfterComplete, rerunIntervalMs: s.run.rerunIntervalMs,
      keepBrowserOpenAfterRun: s.run.keepBrowserOpenAfterRun,
      skipViewedCandidates: s.filter.skipViewedCandidates
    }
  }
}
```

- [ ] **Step 4: 运行确认通过** → PASS
- [ ] **Step 5: 写 `mapping.d.ts`** 声明 `RecommendConfigState`、`normalizeRecommendConfig`、`toSavePayload`、`DEFAULTS`(供 .vue/.ts 类型)。
- [ ] **Step 6: Commit** `feat(ui): testable recommend-config mapping (normalize/toSavePayload)`

---

## Task 4: FilterRuleRow.vue（通用筛选行）

**Files:** Create `.../RecommendAutomation/FilterRuleRow.vue`

通用"启用开关 + 标签 + 输入槽(slot) + 帮助文字"。Props: `label: string`, `enabled: boolean`(v-model:enabled), `help?: string`。默认 slot 放具体输入控件。启用关闭时输入槽禁用(灰显)。用 el-checkbox + UnoCSS 排版,跟随 `BossAutoBrowseAndChat` 的 `.form-tip` 风格。

- [ ] Step 1: 写组件(template + script setup + scoped style)。
- [ ] Step 2: `pnpm -F geekgeekrun-ui typecheck` 通过(组件被 index 引用后整体 typecheck;此任务先单独保证无语法/类型错误,可临时在 index 引用)。
- [ ] Step 3: Commit `feat(ui): FilterRuleRow shared component`

---

## Task 5–8: 四个 Tab 组件

每个 Tab：`<script setup>` + `defineProps<{ modelValue: <切片类型> }>()` + `defineEmits(['update:modelValue'])`,用 `el-form label-position="top"` + `el-card`。字段严格对应设计 §4 各 Tab 列表与 mapping state 切片。

- [ ] **Task 5 ScoringTab.vue**：scoring 切片。JD textarea、enabled switch、minScoreToChat(slider/number 0–100)、onScoreError(radio: 跳过/规则通过即打招呼)、modelId(el-select，选项来自 `boss-fetch-llm-config` 拉取的启用模型,空=默认)。顶部说明：关=规则-only,开=LLM 精排。底部链接说明:供应商在 BossLlmConfig、可视化 rubric 在 BossJobConfig。Commit。
- [ ] **Task 6 CardFilterTab.vue**：filter 切片。用 8× `FilterRuleRow`:城市/学历(正则+快填)/年限(双 number)/薪资(双 number + 面议 radio)/关键词/**院校**/**专业**/屏蔽姓名(正则) + skipViewed checkbox。院校/专业 help 文案见设计 §4②。正则字段即时 `new RegExp` 校验提示。顶部一句"命中即省一次开简历"。Commit。
- [ ] **Task 7 BudgetTab.vue**：budget 切片。maxGreetPerRun/maxXPerRun/maxScrollSteps/maxStaleWaves/waveSize(number)、scrollDelayMsRange/delayBetweenActionsMs(双 number)、greetingMessage(textarea)、maxChatPerRun。顶部醒目 `el-alert type="warning"`:激进滚动曾致封号,这些上限是自我约束,调小更安全。Commit。
- [ ] **Task 8 RunTab.vue**：run 切片 + sequenceJobsEnabled prop。clickNotInterestedForFiltered checkbox;分组「仅推荐牛人单跑生效」:runOnceAfterComplete/rerunIntervalMs/keepBrowserOpenAfterRun;persistProfile(风险说明);若 `sequenceJobsEnabled` 显示 `el-alert`(见设计 §3 守卫文案)。运行按钮区由 index 提供(本组件只配置项)。Commit。

每个 Task：写组件 → typecheck → commit。

---

## Task 9: index.vue 外壳 + useRecommendConfig.ts

**Files:** Create `.../RecommendAutomation/index.vue`, `.../RecommendAutomation/useRecommendConfig.ts`

- [ ] **Step 1: `useRecommendConfig.ts`**：`const { ipcRenderer } = electron`。`load()`→`ipcRenderer.invoke('fetch-boss-recruiter-config-file-content')` 取 `.config`,连同 `ipcRenderer.invoke('fetch-boss-jobs-config')` 算 `sequenceJobsEnabled = (jobs||[]).some(j => j.sequence?.enabled)`,调 `normalizeRecommendConfig` 返回 `reactive` state + `sequenceJobsEnabled`。`save(state)`→`ipcRenderer.invoke('save-boss-recruiter-config', JSON.stringify(toSavePayload(state)))`。`fetchModels()`→`boss-fetch-llm-config` 返回启用模型列表。
- [ ] **Step 2: `index.vue`**：`el-tabs`(4 tab,card 风格) 承载四组件,`v-model` 绑 state 各切片;底部固定操作条:`仅保存`/`保存并运行`(run→save 后 `run-boss-recommend`)/`停止`(`stop-boss-recommend`),`RunningOverlay`(参照 BossAutoBrowseAndChat:163 用法)。`onMounted` load。保存成功/失败 `ElMessage`。`保存并运行`前:若 `scoring.enabled` 且无 jd 且无 rubric → `ElMessageBox` 提示将回退规则-only。
- [ ] **Step 3: typecheck** 通过。
- [ ] **Step 4: Commit** `feat(ui): RecommendAutomation page shell + config composable`

---

## Task 10: 路由 + 导航接线

**Files:** Modify `router/index.ts`, `LeftNavBar/RecruiterPart.vue`

- [ ] **Step 1:** 在 MainLayout children 增 `{ name: 'RecommendAutomation', path: 'RecommendAutomation', component: () => import('@renderer/page/MainLayout/RecommendAutomation/index.vue') }`。
- [ ] **Step 2:** RecruiterPart.vue「自动化执行」组首位加 `RouterLink :to="{ name: 'RecommendAutomation' }"` 文案「推荐牛人 · 配置与运行（新）」;旧 `BossAutoBrowseAndChat`/`BossChatPage`/`BossAutoSequence` 保留(可加注「旧版」)。
- [ ] **Step 3: typecheck + build** 通过。
- [ ] **Step 4: Commit** `feat(ui): wire RecommendAutomation into router + nav`

---

## Task 11: save-boss-recruiter-config IPC 透传 school/major/scoring

**Files:** Modify `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts:993-1024`

- [ ] **Step 1:** 在 `advanced` 处理后追加 scoring 合并到 boss-recruiter.json：
```ts
    if (hasOwn(payload, 'scoring') && payload.scoring && typeof payload.scoring === 'object') {
      bossRecruiterConfig.scoring = { ...bossRecruiterConfig.scoring, ...payload.scoring }
    }
```
- [ ] **Step 2:** 在 candidate-filter 段 `skipViewedCandidates` 后追加：
```ts
    if (hasOwn(payload, 'expectSchoolKeywords')) {
      candidateFilterConfig.expectSchoolKeywords = payload.expectSchoolKeywords
    }
    if (hasOwn(payload, 'expectMajorKeywords')) {
      candidateFilterConfig.expectMajorKeywords = payload.expectMajorKeywords
    }
```
- [ ] **Step 3: typecheck:node** 通过(`pnpm -F geekgeekrun-ui typecheck`)。
- [ ] **Step 4: Commit** `feat(ui): persist school/major filters + scoring via save-boss-recruiter-config`

---

## Task 12: 全量验证 + 最终评审

- [ ] **Step 1:** `cd packages/boss-auto-browse-and-chat && node --test recommend/pure/*.test.mjs` → all pass
- [ ] **Step 2:** `cd packages/ui && node --test src/renderer/src/page/MainLayout/RecommendAutomation/mapping.test.mjs` → pass
- [ ] **Step 3:** `pnpm -F geekgeekrun-ui typecheck` → 0 errors
- [ ] **Step 4:** `pnpm -F geekgeekrun-ui build` → 成功
- [ ] **Step 5:** 派 codex + opus 子代理对整改做最终评审(契约键名、sequence 守卫、无破坏旧页);修问题。
- [ ] **Step 6:** 留 `LIVE-VERIFY PENDING` 注释清单(真站点小额度跑要点);不 push/PR/merge,交回用户。

---

## Self-Review 备忘
- 键名三处对齐:mapping.toSavePayload ↔ save-boss-recruiter-config handler ↔ index.mjs recCfg。Task 3 测试锁 toSavePayload;Task 11 锁 handler;Task 12 typecheck/build 兜底。
- 风险最高项已被 codex 标注并处理:scoring 落 boss-recruiter.json(Task 11)、sequence 守卫(Task 8/9)、per-job 不丢键(Task 1)、死键 clickNotInterestedForFiltered 真实生效(Task 2)。
