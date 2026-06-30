# 推荐牛人页自动化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recommend-page automation in `packages/boss-auto-browse-and-chat` with an account-safe, state-aware wave loop that rule-filters on list text, scores survivors via online resume + LLM, and greets the best within a hard daily budget — without unbounded scrolling.

**Architecture:** A `recommend/` module folder splits the tangled `index.mjs` loop into small units: pure logic (rule-filter, reason matcher, prescore, scorer gate, state classifier, card mappers) that is unit-tested with `node:test`, plus thin puppeteer IO units (page-state signal gathering, list scraper, resume inspector, actions) driven by an `orchestrator` that owns budgets, stop conditions, and the existing tapable hooks. Page state is detected before/after every action; the only scrolling path is a hard-capped `scrollGently`.

**Tech Stack:** Node 20 ESM (`.mjs`, no build step), puppeteer 24 + ghost-cursor, tapable hooks, `node:test` + `node:assert` for unit tests, existing `@geekgeekrun/utils` GPT helper. Source of truth: the approved spec `docs/superpowers/specs/2026-06-11-recommend-page-redesign-design.md` and captures in `packages/boss-auto-browse-and-chat/dev/snapshots/`.

**Conventions (enforced):** no semicolons, single quotes, `printWidth: 100`, no trailing commas. All clicks via ghost-cursor + random delays. `encryptGeekId` is the canonical id everywhere.

---

## File Structure

All new files under `packages/boss-auto-browse-and-chat/recommend/`:

| File | Responsibility | Tested by |
|------|----------------|-----------|
| `pure/rule-filter.mjs` | List-text hard rules → `pass` / `{reject, reason}` (wraps existing `filterCandidates`) | `pure/rule-filter.test.mjs` |
| `pure/reason-matcher.mjs` | `fuzzyReason(internalReason, optionTexts)` → best matching option text | `pure/reason-matcher.test.mjs` |
| `pure/prescore.mjs` | `cheapPrescore(card)` → number, for best-first wave ordering | `pure/prescore.test.mjs` |
| `pure/scorer-gate.mjs` | `ruleGate(merged, cfg)` → `pass`/`hardReject`; `mergeScore(...)` | `pure/scorer-gate.test.mjs` |
| `pure/state-classifier.mjs` | `classifyState(signals)` → state enum (pure, signals-in) | `pure/state-classifier.test.mjs` |
| `pure/card-mapper.mjs` | `mapRawCard(raw)` → normalized candidate; `isPrimaryCard(raw)` | `pure/card-mapper.test.mjs` |
| `page-state.mjs` | `gatherSignals(page, frame)` (page.evaluate) → calls `classifyState`; `waitForState`; `selfHeal` | live smoke |
| `list-scraper.mjs` | `scrapeCards(frame)` (page.evaluate) → raw cards → `mapRawCard` | live smoke |
| `resume-inspector.mjs` | `openResume / assertIdentity / readSummary / greetInModal / confirmGreet / close` | live smoke |
| `actions.mjs` | `rejectFromList(+fuzzy reason) / scrollGently` (ghost-cursor) | live smoke |
| `scorer.mjs` | `score(card, resume, cfg)` = `ruleGate` + LLM call + `mergeScore` | unit (mocked LLM) |
| `orchestrator.mjs` | wave loop, budgets, stop conditions, hooks, self-heal | live smoke |

Modified: `constant.mjs` (selectors + reason config), `index.mjs` (wire orchestrator).

Test command (from `packages/boss-auto-browse-and-chat/`): `node --test recommend/pure/*.test.mjs`

---

## Phase 0 — Harness

### Task 0: Confirm `node:test` runs in this package

**Files:**
- Create: `packages/boss-auto-browse-and-chat/recommend/pure/_smoke.test.mjs`

- [ ] **Step 1: Write a trivial test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('node:test harness works', () => {
  assert.equal(1 + 1, 2)
})
```

- [ ] **Step 2: Run it**

Run (from `packages/boss-auto-browse-and-chat/`): `node --test recommend/pure/_smoke.test.mjs`
Expected: `# pass 1` in output, exit code 0.

- [ ] **Step 3: Delete the smoke file and commit the convention**

```bash
rm recommend/pure/_smoke.test.mjs
git add -A && git commit -m "chore(recommend): confirm node:test harness"
```

---

## Phase 1 — Pure logic (full TDD)

### Task 1: `constant.mjs` selectors + reason config

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/constant.mjs`

No test (constants). Add the following exports (verified against `dev/snapshots/`). Keep existing exports; ADD these and FIX `RESUME_POPUP_CLOSE_SELECTOR`.

- [ ] **Step 1: Add recommend-redesign selectors**

```js
// ── 推荐牛人页重构 v2 选择器（对照 dev/snapshots/ 校验） ──

/** 主候选卡：li.card-item 内的主卡 card-inner（带 data-geek）。排除 similar-geek-wrap/quick-top。 */
export const PRIMARY_CARD_INNER_SELECTOR = 'li.card-item > div.candidate-card-wrap > div.card-inner[data-geek]'
/** li.card-item 内若含此元素则为"相似推荐"块，整条跳过 */
export const SIMILAR_WRAP_SELECTOR = 'div.similar-geek-wrap'

/** 简历弹窗（recommendFrame 内）容器 */
export const RESUME_MODAL_SELECTOR = 'div.dialog-wrap.active .dialog-lib-resume'
/** 简历弹窗内"打招呼"按钮 */
export const RESUME_GREET_BTN_SELECTOR = '.button-chat-wrap.resumeGreet button.btn-greet'
/** 简历弹窗内打招呼成功信号（按钮变"继续沟通"） */
export const RESUME_GREET_DONE_SELECTOR = '.button-chat-wrap .btn-continue-wrap, .button-chat-wrap button.btn-outline-v2'
/** 简历弹窗内"经历概览"文本容器 */
export const RESUME_SUMMARY_SELECTOR = '.resume-right-side .resume-summary'
/** 简历弹窗关闭按钮（在 recommendFrame 内的弹窗上，非主页面） */
export const RESUME_MODAL_CLOSE_SELECTOR = 'div.dialog-wrap.active .dialog-lib-resume .close-btn'

/** 账号封禁文案（不可恢复 → 中止）。真机需再核对精确字符串。 */
export const ACCOUNT_BANNED_TEXT_REGEXP = /账号.*不可使用|不可使用状态|登录\s*BOSS直聘手机APP查看详情/
/** 今日额度用尽文案 */
export const QUOTA_BLOCKED_TEXT_REGEXP = /今日.*(招呼|沟通).*上限|已达上限|超过.*上限/
```

- [ ] **Step 2: Fix the wrong resume-close constant (keep name for back-compat, point at frame modal)**

Replace the line:
```js
export const RESUME_POPUP_CLOSE_SELECTOR = 'div.boss-popup__close'
```
with:
```js
/** @deprecated 用 RESUME_MODAL_CLOSE_SELECTOR；旧值查主页面、对 iframe 内简历弹窗无效 */
export const RESUME_POPUP_CLOSE_SELECTOR = RESUME_MODAL_CLOSE_SELECTOR
```
(Place the `RESUME_MODAL_CLOSE_SELECTOR` export ABOVE this line so it is defined first.)

- [ ] **Step 3: Add fuzzy reason rules (replace reliance on the exact map)**

```js
/** 模糊原因规则：internalReason → 选项文案需包含的子串（按序取第一个命中的选项；都不中用 NOT_INTERESTED_REASON_FALLBACK） */
export const NOT_INTERESTED_FUZZY_RULES = {
  city: ['距离远'],
  education: ['不考虑'],
  workExp: ['与职位不符', '工作经历'],
  skills: ['与职位不符', '工作经历'],
  viewed: ['重复推荐'],
  blockName: ['其他原因']
}
```

- [ ] **Step 4: Commit**

```bash
git add constant.mjs
git commit -m "feat(recommend): add v2 selectors + fuzzy reason rules, fix resume-close"
```

---

### Task 2: `reason-matcher.mjs`

**Files:**
- Create: `recommend/pure/reason-matcher.mjs`
- Test: `recommend/pure/reason-matcher.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyReason } from './reason-matcher.mjs'

const FALLBACK = '其他原因'
// 真实选项（来自 dev/snapshots/005-reason-popup 与 001-resume-reject，文案随候选人/JD 变化）
const OPTIONS = ['牛人距离远', '不考虑硕士', '期望薪资偏高', '期望（药物分析）与职位不符', '年龄不合适', '工作经历和制剂研发无关', '活跃度低', '重复推荐', '其他原因']

test('city → 距离远', () => {
  assert.equal(fuzzyReason('city', OPTIONS, FALLBACK), '牛人距离远')
})
test('education matches 不考虑硕士 even though hardcoded enum said 本科', () => {
  assert.equal(fuzzyReason('education', OPTIONS, FALLBACK), '不考虑硕士')
})
test('workExp → 与职位不符 preferred over 工作经历', () => {
  assert.equal(fuzzyReason('workExp', OPTIONS, FALLBACK), '期望（药物分析）与职位不符')
})
test('viewed → 重复推荐', () => {
  assert.equal(fuzzyReason('viewed', OPTIONS, FALLBACK), '重复推荐')
})
test('unknown reason → fallback', () => {
  assert.equal(fuzzyReason('zzz', OPTIONS, FALLBACK), '其他原因')
})
test('no option matches → fallback', () => {
  assert.equal(fuzzyReason('city', ['仅这一个'], FALLBACK), '仅这一个'.includes('距离远') ? '仅这一个' : FALLBACK)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/reason-matcher.test.mjs`
Expected: FAIL (`Cannot find module './reason-matcher.mjs'`).

- [ ] **Step 3: Implement**

```js
import { NOT_INTERESTED_FUZZY_RULES } from '../../constant.mjs'

/**
 * 在动态生成的原因选项里，按 internalReason 的子串规则选最贴切的一项。
 * @param {string} internalReason - city|education|workExp|skills|viewed|blockName|...
 * @param {string[]} optionTexts - 弹窗里实际出现的选项文案
 * @param {string} fallback - 都不命中时返回（通常"其他原因"）
 * @returns {string} 选中的选项文案；若 optionTexts 里没有 fallback，则返回第一个选项兜底
 */
export function fuzzyReason (internalReason, optionTexts, fallback) {
  const substrs = NOT_INTERESTED_FUZZY_RULES[internalReason] || []
  for (const needle of substrs) {
    const hit = optionTexts.find((t) => t.includes(needle))
    if (hit) return hit
  }
  const fb = optionTexts.find((t) => t.includes(fallback))
  if (fb) return fb
  return optionTexts[0] ?? fallback
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/reason-matcher.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/reason-matcher.mjs recommend/pure/reason-matcher.test.mjs
git commit -m "feat(recommend): fuzzy reason matcher for dynamic 不感兴趣 options"
```

---

### Task 3: `rule-filter.mjs` (wrap existing `filterCandidates`)

**Files:**
- Create: `recommend/pure/rule-filter.mjs`
- Test: `recommend/pure/rule-filter.test.mjs`
- Reference (do not modify yet): `candidate-processor.mjs` `filterCandidates`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleFilterList } from './rule-filter.mjs'

const cfg = { expectEducationList: ['硕士', '博士'], expectSalaryRange: [10, 30], expectSalaryWhenNegotiable: 'include' }

test('passes a matching candidate', () => {
  const c = { encryptGeekId: 'a', geekName: '甲', education: '硕士', salary: '10-15K' }
  assert.deepEqual(ruleFilterList(c, cfg), { result: 'pass' })
})
test('rejects on education with reason', () => {
  const c = { encryptGeekId: 'b', geekName: '乙', education: '本科', salary: '10-15K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'education')
})
test('rejects on salary too high', () => {
  const c = { encryptGeekId: 'c', geekName: '丙', education: '硕士', salary: '40-50K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'salary')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/rule-filter.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (delegate to existing filterCandidates, single-candidate adapter)**

```js
import { filterCandidates } from '../../candidate-processor.mjs'

/**
 * 单个候选人的列表硬规则初筛。复用现有 filterCandidates（批处理）的全部规则与 reason 体系。
 * @param {object} candidate - 含 encryptGeekId/geekName/education/workExp/city/salary/skills 的归一化卡片
 * @param {object} ruleCfg - candidate-filter 配置形状
 * @returns {{result:'pass'} | {result:'reject', reason:string, reasonDetail?:string}}
 */
export function ruleFilterList (candidate, ruleCfg) {
  const { matched, skipped } = filterCandidates([candidate], ruleCfg || {})
  if (matched.length) return { result: 'pass' }
  const fr = skipped[0]?.filterResult
  return { result: 'reject', reason: fr?.reason ?? 'skills', reasonDetail: fr?.reasonDetail }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/rule-filter.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/rule-filter.mjs recommend/pure/rule-filter.test.mjs
git commit -m "feat(recommend): single-candidate rule pre-filter reusing filterCandidates"
```

---

### Task 4: `prescore.mjs` (cheap best-first ordering)

**Files:**
- Create: `recommend/pure/prescore.mjs`
- Test: `recommend/pure/prescore.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cheapPrescore } from './prescore.mjs'

test('higher degree scores higher', () => {
  const phd = cheapPrescore({ education: '博士', tags: [] })
  const bsc = cheapPrescore({ education: '本科', tags: [] })
  assert.ok(phd > bsc)
})
test('QS/985/211 tags add points', () => {
  const tagged = cheapPrescore({ education: '硕士', tags: ['QS前500院校'] })
  const plain = cheapPrescore({ education: '硕士', tags: [] })
  assert.ok(tagged > plain)
})
test('missing fields do not throw and score finite', () => {
  const s = cheapPrescore({})
  assert.ok(Number.isFinite(s))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/prescore.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
const DEGREE_RANK = { 博士: 5, 硕士: 4, 本科: 3, 大专: 2, 专科: 2, 高中: 1 }
const GOOD_TAG_RE = /QS|985|211|双一流|海归|留学/

/**
 * 仅用列表文字给个便宜的预估分，用于"先处理更可能优的"排序。不调用任何 IO。
 * 不是最终评分（最终分见 scorer.mjs）。
 * @param {{education?:string, tags?:string[], activeText?:string}} card
 * @returns {number}
 */
export function cheapPrescore (card) {
  let s = 0
  const deg = card?.education ?? ''
  for (const k of Object.keys(DEGREE_RANK)) if (deg.includes(k)) { s += DEGREE_RANK[k] * 10; break }
  const tags = Array.isArray(card?.tags) ? card.tags : []
  if (tags.some((t) => GOOD_TAG_RE.test(t))) s += 15
  if (/刚刚活跃|今日活跃|活跃/.test(card?.activeText ?? '')) s += 5
  return s
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/prescore.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/prescore.mjs recommend/pure/prescore.test.mjs
git commit -m "feat(recommend): cheap list-text prescore for best-first wave ordering"
```

---

### Task 5: `scorer-gate.mjs` (rule gate + score merge, pure)

**Files:**
- Create: `recommend/pure/scorer-gate.mjs`
- Test: `recommend/pure/scorer-gate.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleGate, mergeScore } from './scorer-gate.mjs'

test('ruleGate hardReject when resume rule fails', () => {
  const r = ruleGate({ education: '本科' }, { expectEducationList: ['硕士'] })
  assert.equal(r.result, 'hardReject')
  assert.equal(r.reason, 'education')
})
test('ruleGate pass when rules ok', () => {
  const r = ruleGate({ education: '硕士' }, { expectEducationList: ['硕士'] })
  assert.equal(r.result, 'pass')
})
test('mergeScore: gate hardReject overrides llm', () => {
  const m = mergeScore({ result: 'hardReject', reason: 'education' }, { score: 90 }, { minScoreToChat: 60 })
  assert.equal(m.hardReject, true)
})
test('mergeScore: llm null + onScoreError skip → below threshold, not hardReject', () => {
  const m = mergeScore({ result: 'pass' }, null, { minScoreToChat: 60, onScoreError: 'skip' })
  assert.equal(m.hardReject, false)
  assert.ok(m.score < 60)
})
test('mergeScore: llm null + greetIfRulePass → score at threshold', () => {
  const m = mergeScore({ result: 'pass' }, null, { minScoreToChat: 60, onScoreError: 'greetIfRulePass' })
  assert.ok(m.score >= 60)
})
test('mergeScore: normal llm score passes through', () => {
  const m = mergeScore({ result: 'pass' }, { score: 75, reason: 'good' }, { minScoreToChat: 60 })
  assert.equal(m.score, 75)
  assert.equal(m.hardReject, false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/scorer-gate.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
import { ruleFilterList } from './rule-filter.mjs'

/**
 * 评分前的硬规则门：作用在简历+列表合并数据上。硬不达标 → hardReject（进入 X），不调 LLM。
 * @returns {{result:'pass'} | {result:'hardReject', reason:string}}
 */
export function ruleGate (merged, ruleCfg) {
  const r = ruleFilterList(merged, ruleCfg)
  if (r.result === 'reject') return { result: 'hardReject', reason: r.reason }
  return { result: 'pass' }
}

/**
 * 合并规则门与 LLM 结果为最终判定。
 * @param {{result:string, reason?:string}} gate
 * @param {{score:number, reason?:string}|null} llm - null 表示 LLM 失败
 * @param {{minScoreToChat:number, onScoreError?:'skip'|'greetIfRulePass'}} cfg
 * @returns {{score:number, reason:string, hardReject:boolean}}
 */
export function mergeScore (gate, llm, cfg) {
  if (gate.result === 'hardReject') {
    return { score: 0, reason: gate.reason, hardReject: true }
  }
  if (llm == null) {
    const score = cfg.onScoreError === 'greetIfRulePass' ? cfg.minScoreToChat : Math.max(0, cfg.minScoreToChat - 1)
    return { score, reason: 'llm-error', hardReject: false }
  }
  return { score: llm.score, reason: llm.reason ?? '', hardReject: false }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/scorer-gate.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/scorer-gate.mjs recommend/pure/scorer-gate.test.mjs
git commit -m "feat(recommend): pure rule-gate + score-merge for scorer"
```

---

### Task 6: `card-mapper.mjs` (raw card → normalized; primary-card filter)

**Files:**
- Create: `recommend/pure/card-mapper.mjs`
- Test: `recommend/pure/card-mapper.test.mjs`

The page.evaluate in `list-scraper` returns plain "raw" objects (already strings/arrays — no DOM). `mapRawCard` normalizes them and `isPrimaryCard` drops similar/promo. This keeps DOM extraction thin and the mapping testable.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRawCard, isPrimaryCard } from './card-mapper.mjs'

const raw = {
  encryptGeekId: '32a7d58d87424e000HF83tm9EFpZ',
  name: '朱睿婕', salary: '10-11K', activeText: '刚刚活跃',
  baseInfo: ['25岁', '26年应届生', '硕士'],
  expect: ['杭州', '化工'], advantage: '具备扎实科研能力', tags: ['QS前500院校'],
  isSimilar: false, inViewport: true, interactable: true
}

test('maps base-info into education/workExp/age', () => {
  const c = mapRawCard(raw)
  assert.equal(c.encryptGeekId, raw.encryptGeekId)
  assert.equal(c.education, '硕士')
  assert.equal(c.city, '杭州')
  assert.equal(c.salary, '10-11K')
})
test('isPrimaryCard false when isSimilar', () => {
  assert.equal(isPrimaryCard({ ...raw, isSimilar: true }), false)
})
test('isPrimaryCard false when no encryptGeekId', () => {
  assert.equal(isPrimaryCard({ ...raw, encryptGeekId: '' }), false)
})
test('isPrimaryCard true for a normal card', () => {
  assert.equal(isPrimaryCard(raw), true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/card-mapper.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
const DEGREE_RE = /本科|硕士|博士|大专|专科|MBA|中专|高中|初中/

/**
 * 归一化 list-scraper 抽出的 raw 卡片为筛选/评分用的候选对象。纯函数。
 */
export function mapRawCard (raw) {
  const baseInfo = Array.isArray(raw.baseInfo) ? raw.baseInfo : []
  const expect = Array.isArray(raw.expect) ? raw.expect : []
  return {
    encryptGeekId: raw.encryptGeekId ?? '',
    geekName: raw.name ?? '',
    salary: raw.salary ?? null,
    activeText: raw.activeText ?? '',
    age: baseInfo.find((s) => /岁/.test(s)) ?? null,
    workExp: baseInfo.find((s) => /年|经验不限/.test(s)) ?? null,
    education: baseInfo.find((s) => DEGREE_RE.test(s)) ?? null,
    city: expect[0] ?? null,
    jobTitle: expect[1] ?? null,
    skills: raw.advantage ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    inViewport: !!raw.inViewport,
    interactable: !!raw.interactable
  }
}

/** 是否主候选卡（排除相似推荐/促销、无 id 的） */
export function isPrimaryCard (raw) {
  if (!raw) return false
  if (raw.isSimilar) return false
  if (!raw.encryptGeekId) return false
  return true
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/card-mapper.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/card-mapper.mjs recommend/pure/card-mapper.test.mjs
git commit -m "feat(recommend): pure card mapper + primary-card filter"
```

---

### Task 7: `state-classifier.mjs` (pure state decision)

**Files:**
- Create: `recommend/pure/state-classifier.mjs`
- Test: `recommend/pure/state-classifier.test.mjs`

`gatherSignals` (Task 9) extracts plain booleans/strings from the page; `classifyState` decides the enum from them. This makes the state logic unit-testable without a browser.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyState, STATES } from './state-classifier.mjs'

const base = { mainText: '', mainOverlayClasses: [], frameOverlayClasses: [], frameHasList: true, verify: false }

test('ACCOUNT_BANNED beats everything', () => {
  const s = classifyState({ ...base, mainText: '您的账号当前处于不可使用状态，请登录BOSS直聘手机APP查看详情', frameOverlayClasses: ['dialog-wrap active'] })
  assert.equal(s, STATES.ACCOUNT_BANNED)
})
test('VERIFY when risk-detector flag set', () => {
  assert.equal(classifyState({ ...base, verify: true }), STATES.VERIFY)
})
test('RESUME_MODAL when frame has dialog-lib-resume', () => {
  assert.equal(classifyState({ ...base, frameOverlayClasses: ['dialog-wrap active dialog-lib-resume'] }), STATES.RESUME_MODAL)
})
test('LIST_REASON_PANEL on card-reason-f1 show', () => {
  assert.equal(classifyState({ ...base, frameOverlayClasses: ['card-reason-f1 show'] }), STATES.LIST_REASON_PANEL)
})
test('RESUME_REJECT_DIALOG on main feedback-wrap', () => {
  assert.equal(classifyState({ ...base, mainOverlayClasses: ['dialog-wrap active'], mainText: '选择原因，推荐更合适牛人 提交' }), STATES.RESUME_REJECT_DIALOG)
})
test('GOVERNANCE_NOTICE on dialog-uninstall-extension', () => {
  assert.equal(classifyState({ ...base, mainOverlayClasses: ['dialog-uninstall-extension'] }), STATES.GOVERNANCE_NOTICE)
})
test('QUOTA_BLOCKED on quota text', () => {
  assert.equal(classifyState({ ...base, mainText: '今日打招呼已达上限' }), STATES.QUOTA_BLOCKED)
})
test('LIST when clean', () => {
  assert.equal(classifyState(base), STATES.LIST)
})
test('UNKNOWN when no list and nothing matches', () => {
  assert.equal(classifyState({ ...base, frameHasList: false }), STATES.UNKNOWN)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test recommend/pure/state-classifier.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
import { ACCOUNT_BANNED_TEXT_REGEXP, QUOTA_BLOCKED_TEXT_REGEXP } from '../../constant.mjs'

export const STATES = {
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  VERIFY: 'VERIFY',
  RESUME_MODAL: 'RESUME_MODAL',
  LIST_REASON_PANEL: 'LIST_REASON_PANEL',
  RESUME_REJECT_DIALOG: 'RESUME_REJECT_DIALOG',
  GOVERNANCE_NOTICE: 'GOVERNANCE_NOTICE',
  QUOTA_BLOCKED: 'QUOTA_BLOCKED',
  LIST: 'LIST',
  UNKNOWN: 'UNKNOWN'
}

const has = (classes, needle) => classes.some((c) => c.includes(needle))

/**
 * 纯状态判定。signals 由 gatherSignals 从主页面+recommendFrame 抽取。
 * 优先级：封禁 > 验证 > 简历弹窗 > 列表原因面板 > 简历拒绝弹窗 > 治理公告 > 额度 > 列表 > 未知。
 * @param {{mainText:string, mainOverlayClasses:string[], frameOverlayClasses:string[], frameHasList:boolean, verify:boolean}} s
 */
export function classifyState (s) {
  if (ACCOUNT_BANNED_TEXT_REGEXP.test(s.mainText || '')) return STATES.ACCOUNT_BANNED
  if (s.verify) return STATES.VERIFY
  if (has(s.frameOverlayClasses, 'dialog-lib-resume')) return STATES.RESUME_MODAL
  if (has(s.frameOverlayClasses, 'card-reason-f1')) return STATES.LIST_REASON_PANEL
  if (has(s.mainOverlayClasses, 'dialog-wrap') && /选择原因|提交/.test(s.mainText || '')) return STATES.RESUME_REJECT_DIALOG
  if (has(s.mainOverlayClasses, 'dialog-uninstall-extension')) return STATES.GOVERNANCE_NOTICE
  if (QUOTA_BLOCKED_TEXT_REGEXP.test(s.mainText || '')) return STATES.QUOTA_BLOCKED
  if (s.frameHasList) return STATES.LIST
  return STATES.UNKNOWN
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test recommend/pure/state-classifier.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/pure/state-classifier.mjs recommend/pure/state-classifier.test.mjs
git commit -m "feat(recommend): pure page-state classifier with banned-vs-verify split"
```

---

## Phase 2 — Puppeteer IO units (live-verified)

> These touch the real page. Unit tests can't cover `page.evaluate`/clicks; verify each with the dev capture browser or a tiny live smoke. Use the EXACT selectors from `constant.mjs`. Keep in-page functions self-contained (no outer refs — they're serialized). Each task ends by running `node --check <file>` and a manual smoke note.

### Task 8: `scorer.mjs` (gate + LLM, mocked-LLM unit test)

**Files:**
- Create: `recommend/scorer.mjs`
- Test: `recommend/scorer.test.mjs`
- Reference: `@geekgeekrun/utils` GPT helper (inspect its export name before wiring; e.g. `getGptResponse`/`requestOpenai` — confirm in `packages/utils`).

- [ ] **Step 1: Confirm the GPT helper export**

Run: `node -e "import('@geekgeekrun/utils/gpt.mjs').then(m=>console.log(Object.keys(m))).catch(e=>console.log('no gpt.mjs',e.message))"`
(If path differs, grep `packages/utils` for the request function and note the real specifier.)

- [ ] **Step 2: Write the failing test (LLM injected for testability)**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { score } from './scorer.mjs'

const cfg = { rules: { expectEducationList: ['硕士'] }, minScoreToChat: 60, onScoreError: 'skip', jd: 'JD', llm: {} }

test('hardReject short-circuits without calling LLM', async () => {
  let called = false
  const fakeLlm = async () => { called = true; return { score: 99 } }
  const r = await score({ education: '本科' }, { summary: '' }, cfg, fakeLlm)
  assert.equal(r.hardReject, true)
  assert.equal(called, false)
})
test('passes through LLM score on rule pass', async () => {
  const fakeLlm = async () => ({ score: 72, reason: 'ok' })
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.score, 72)
  assert.equal(r.hardReject, false)
})
test('LLM throw → merged via onScoreError skip', async () => {
  const fakeLlm = async () => { throw new Error('rate limit') }
  const r = await score({ education: '硕士' }, { summary: 's' }, cfg, fakeLlm)
  assert.equal(r.hardReject, false)
  assert.ok(r.score < 60)
})
```

- [ ] **Step 3: Implement (LLM as injected dep with a real default)**

```js
import { ruleGate, mergeScore } from './pure/scorer-gate.mjs'
// import { <realGptFn> } from '@geekgeekrun/utils/<confirmed-path>'  // wire after Step 1

/**
 * 调 LLM 给候选人打分。可注入 llmFn 便于测试。
 * @param {(payload:object)=>Promise<{score:number,reason?:string}>} [llmFn]
 */
export async function score (merged, resume, cfg, llmFn) {
  const gate = ruleGate(merged, cfg.rules || {})
  if (gate.result === 'hardReject') return mergeScore(gate, null, cfg) // 不调 LLM
  let llm = null
  try {
    const fn = llmFn || defaultLlm
    llm = await fn({ jd: cfg.jd, candidate: merged, resume, llmCfg: cfg.llm })
  } catch (e) {
    llm = null
  }
  return mergeScore({ result: 'pass' }, llm, cfg)
}

/** 默认 LLM：拼 prompt → 调 utils GPT → 解析 {score,reason}。Step 1 确认 import 后填实。 */
async function defaultLlm (/* payload */) {
  // TODO(wire): 用 cfg.llm.promptTemplate + payload 调 @geekgeekrun/utils GPT，解析 JSON {score,reason}
  throw new Error('defaultLlm not wired — inject llmFn in tests; wire real GPT call before live run')
}
```

> Note: `defaultLlm` is intentionally unwired until Step 1 confirms the helper. The orchestrator passes a wired `llmFn` (Task 12 Step on wiring). Tests inject a fake. This is a real seam, not a placeholder — the function signature and contract are fixed.

- [ ] **Step 4: Run unit tests**

Run: `node --test recommend/scorer.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add recommend/scorer.mjs recommend/scorer.test.mjs
git commit -m "feat(recommend): scorer with rule gate + injectable LLM"
```

---

### Task 9: `page-state.mjs` (gatherSignals + detectState + waitForState + selfHeal)

**Files:**
- Create: `recommend/page-state.mjs`
- Reference selectors: `constant.mjs`; reuse `risk-detector.mjs` `detectRiskControl`; reuse `dismissGovernanceNoticeDialog` from `index.mjs`.

- [ ] **Step 1: Implement signal gathering + detection**

```js
import { classifyState, STATES } from './pure/state-classifier.mjs'
import { detectRiskControl } from '../risk-detector.mjs'
import { CANDIDATE_LIST_SELECTOR } from '../constant.mjs'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'

/** 在一个上下文里收集可见浮层的 className 列表（自包含，注入用） */
function collectOverlayClassesInPage () {
  const SEL = '[class*="dialog"],[class*="popup"],[class*="reason"],[class*="card-reason"],[class*="feedback"],[class*="uninstall-extension"]'
  const out = []
  for (const el of Array.from(document.querySelectorAll(SEL))) {
    const cn = typeof el.className === 'string' ? el.className : ''
    if (!cn) continue
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    if (r.width > 2 && r.height > 2 && st.display !== 'none' && st.visibility !== 'hidden') out.push(cn)
  }
  return out
}

export async function gatherSignals (page, frame) {
  const verify = await detectRiskControl(page).catch(() => false)
  const mainText = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
  const mainOverlayClasses = await page.evaluate(collectOverlayClassesInPage).catch(() => [])
  let frameOverlayClasses = []
  let frameHasList = false
  if (frame) {
    frameOverlayClasses = await frame.evaluate(collectOverlayClassesInPage).catch(() => [])
    frameHasList = await frame.evaluate((sel) => !!document.querySelector(sel), CANDIDATE_LIST_SELECTOR).catch(() => false)
  }
  return { mainText, mainOverlayClasses, frameOverlayClasses, frameHasList, verify }
}

export async function detectState (page, frame) {
  return classifyState(await gatherSignals(page, frame))
}

export async function waitForState (page, frame, target, { timeoutMs = 8000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await detectState(page, frame) === target) return true
    await sleep(intervalMs)
  }
  return false
}

export { STATES }
```

- [ ] **Step 2: Add `selfHeal` (close stray dialogs back to LIST)**

```js
import { RESUME_MODAL_CLOSE_SELECTOR, NOT_INTERESTED_REASON_POPUP_CLOSE_SELECTOR } from '../constant.mjs'
import { dismissGovernanceNoticeDialog } from '../index.mjs'

/**
 * 把残留弹窗关回 LIST。返回处理后的状态。绝不处理 ACCOUNT_BANNED（交给调用方中止）。
 */
export async function selfHeal (page, frame) {
  const st = await detectState(page, frame)
  if (st === STATES.GOVERNANCE_NOTICE) { await dismissGovernanceNoticeDialog(page).catch(() => {}); return }
  if (st === STATES.RESUME_MODAL && frame) { await frame.$eval(RESUME_MODAL_CLOSE_SELECTOR, (el) => el.click()).catch(() => {}); return }
  if (st === STATES.LIST_REASON_PANEL && frame) { await frame.$eval(NOT_INTERESTED_REASON_POPUP_CLOSE_SELECTOR, (el) => el.click()).catch(() => {}); return }
  if (st === STATES.RESUME_REJECT_DIALOG) { await page.$eval('div.dialog-wrap.active .boss-popup__close', (el) => el.click()).catch(() => {}); return }
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check recommend/page-state.mjs`
Expected: no output (OK).

- [ ] **Step 4: Live smoke (dev browser)**

Using the running `dev/capture-recommend.mjs` browser is not wired to this module; instead add a throwaway `recommend/_smoke-state.mjs` that launches via `buildRecruiterLaunchOptions`, navigates to recommend, and prints `await detectState(page, frame)` every 2s. Manually open/close a resume and confirm it prints `RESUME_MODAL` ↔ `LIST`. Delete the smoke file after. (Do NOT scroll aggressively.)

- [ ] **Step 5: Commit**

```bash
git add recommend/page-state.mjs
git commit -m "feat(recommend): page-state detection, waitForState, selfHeal"
```

---

### Task 10: `list-scraper.mjs` (scrapeCards)

**Files:**
- Create: `recommend/list-scraper.mjs`
- Uses: `card-mapper.mjs`, selectors `PRIMARY_CARD_INNER_SELECTOR`, `SIMILAR_WRAP_SELECTOR`.

- [ ] **Step 1: Implement scrape (raw extraction in-frame → pure mappers in Node)**

```js
import { mapRawCard, isPrimaryCard } from './pure/card-mapper.mjs'

/** 自包含：在 recommendFrame 内抽取每个 li.card-item 的 raw 字段 + 几何/可达性 */
function extractRawCardsInFrame () {
  const vh = (document.scrollingElement || document.documentElement).clientHeight
  const lis = Array.from(document.querySelectorAll('ul.card-list > li.card-item'))
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : '' }
  const txts = (el, sel) => Array.from(el.querySelectorAll(sel)).map((n) => n.textContent.trim()).filter(Boolean)
  return lis.map((li) => {
    const isSimilar = !!li.querySelector('div.similar-geek-wrap')
    const inner = li.querySelector('div.candidate-card-wrap > div.card-inner[data-geek]')
    const r = (inner || li).getBoundingClientRect()
    const inViewport = r.top >= 0 && r.bottom <= vh
    const interactable = r.bottom > 8 && r.top < vh - 8 && r.height > 20
    return {
      encryptGeekId: inner ? (inner.getAttribute('data-geek') || inner.getAttribute('data-geekid') || '') : '',
      isSimilar,
      name: inner ? txt(inner, 'span.name') : '',
      salary: inner ? txt(inner, 'div.salary-wrap span') : '',
      activeText: inner ? txt(inner, 'span.active-text') : '',
      baseInfo: inner ? txts(inner, 'div.base-info span') : [],
      expect: inner ? txts(inner, 'div.expect-wrap span.content div.join-text-wrap span') : [],
      advantage: inner ? txt(inner, 'div.geek-desc span.content') : '',
      tags: inner ? txts(inner, 'div.tags-wrap span.tag-item') : [],
      inViewport, interactable
    }
  })
}

/**
 * 抓主候选卡（已过滤 similar/promo/无 id），归一化。
 * @returns {Promise<Array<object>>}
 */
export async function scrapeCards (frame) {
  if (!frame) return []
  const raw = await frame.evaluate(extractRawCardsInFrame).catch(() => [])
  return raw.filter(isPrimaryCard).map(mapRawCard)
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check recommend/list-scraper.mjs`
Expected: OK.

- [ ] **Step 3: Live smoke**

Throwaway `recommend/_smoke-scrape.mjs`: launch, navigate, `console.log((await scrapeCards(frame)).slice(0,3))`. Confirm names/salary/education populate and the count excludes the similar block. Delete after.

- [ ] **Step 4: Commit**

```bash
git add recommend/list-scraper.mjs
git commit -m "feat(recommend): primary-card scraper with viewport/interactable flags"
```

---

### Task 11: `resume-inspector.mjs` and `actions.mjs`

**Files:**
- Create: `recommend/resume-inspector.mjs`, `recommend/actions.mjs`
- Uses: ghost-cursor (`humanMouse.mjs` `createHumanCursor`), selectors, `page-state.waitForState`, `reason-matcher`.

- [ ] **Step 1: Implement resume-inspector**

```js
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { waitForState, STATES } from './page-state.mjs'
import {
  RESUME_MODAL_SELECTOR, RESUME_GREET_BTN_SELECTOR, RESUME_GREET_DONE_SELECTOR,
  RESUME_SUMMARY_SELECTOR, RESUME_MODAL_CLOSE_SELECTOR
} from '../constant.mjs'

/** 点击某卡片打开简历弹窗。返回是否成功进入 RESUME_MODAL。 */
export async function openResume (page, frame, cursor, encryptGeekId) {
  const sel = `div.card-inner[data-geek="${encryptGeekId}"]`
  const handle = await frame.$(sel)
  if (!handle) return false
  await handle.hover().catch(() => {})
  await cursor.click(handle).catch(async () => { await handle.click().catch(() => {}) })
  return waitForState(page, frame, STATES.RESUME_MODAL, { timeoutMs: 8000 })
}

/** 校验当前简历弹窗就是目标候选人（弹窗有 prev/next，可能残留）。用概览文本里的姓名兜底。 */
export async function assertIdentity (frame, expectedName) {
  const name = await frame.$eval(`${RESUME_MODAL_SELECTOR} .name, ${RESUME_MODAL_SELECTOR} .geek-name`, (el) => el.textContent.trim()).catch(() => null)
  if (!name || !expectedName) return true // 拿不到名字时不阻断，靠后续验证
  return name.includes(expectedName) || expectedName.includes(name)
}

export async function readSummary (frame) {
  const summary = await frame.$eval(RESUME_SUMMARY_SELECTOR, (el) => el.innerText.trim()).catch(() => '')
  return { summary }
}

/** 在简历弹窗内点"打招呼"，等"继续沟通"出现确认成功。 */
export async function greetInModal (frame, cursor) {
  const btn = await frame.$(RESUME_GREET_BTN_SELECTOR)
  if (!btn) return false
  await cursor.click(btn).catch(async () => { await btn.click().catch(() => {}) })
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    const done = await frame.$(RESUME_GREET_DONE_SELECTOR).catch(() => null)
    if (done) return true
    await sleep(300)
  }
  return false
}

export async function closeResume (page, frame, cursor) {
  const btn = await frame.$(RESUME_MODAL_CLOSE_SELECTOR)
  if (btn) await cursor.click(btn).catch(async () => { await btn.click().catch(() => {}) })
  await waitForState(page, frame, STATES.LIST, { timeoutMs: 5000 })
}
```

- [ ] **Step 2: Implement actions (X from list + gentle capped scroll)**

```js
import { sleep, sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { fuzzyReason } from './pure/reason-matcher.mjs'
import { waitForState, STATES } from './page-state.mjs'
import {
  NOT_INTERESTED_IN_ITEM_SELECTOR, NOT_INTERESTED_REASON_ITEMS_SELECTOR,
  NOT_INTERESTED_REASON_FALLBACK
} from '../constant.mjs'

/**
 * 从列表对某候选人点 X 并选原因。等待卡片消失确认生效。
 * @returns {Promise<boolean>}
 */
export async function rejectFromList (page, frame, cursor, encryptGeekId, internalReason) {
  const card = await frame.$(`div.card-inner[data-geek="${encryptGeekId}"]`)
  if (!card) return false
  const x = await card.$('xpath/ancestor::li[contains(@class,"card-item")]//div[contains(@class,"tooltip-wrap") and contains(@class,"suitable")]')
    .catch(() => null) || await frame.$(NOT_INTERESTED_IN_ITEM_SELECTOR)
  if (!x) return false
  await cursor.click(x).catch(async () => { await x.click().catch(() => {}) })
  // 等原因面板
  if (!await waitForState(page, frame, STATES.LIST_REASON_PANEL, { timeoutMs: 4000 })) return false
  const options = await frame.$$eval(NOT_INTERESTED_REASON_ITEMS_SELECTOR, (els) => els.map((e) => e.textContent.trim()))
  const wanted = fuzzyReason(internalReason, options, NOT_INTERESTED_REASON_FALLBACK)
  const items = await frame.$$(NOT_INTERESTED_REASON_ITEMS_SELECTOR)
  for (let i = 0; i < items.length; i++) {
    if (options[i] === wanted) { await cursor.click(items[i]).catch(async () => { await items[i].click().catch(() => {}) }); break }
  }
  return waitForState(page, frame, STATES.LIST, { timeoutMs: 4000 })
}

/**
 * 受硬上限约束的温和滚屏（一次调用 = 一"步"）。绝不一次滚到底。
 */
export async function scrollGently (page, cfg) {
  const [lo, hi] = cfg?.scrollDelayMsRange ?? [800, 2000]
  for (let s = 0; s < 4; s++) {
    await page.mouse.wheel({ deltaY: 120 + Math.floor(60 * Math.random()) })
    await sleep(120 + Math.floor(120 * Math.random()))
  }
  await sleepWithRandomDelay(lo, hi)
}
```

> Verify `sleepWithRandomDelay` is exported from `@geekgeekrun/utils/sleep.mjs` (Step 1 of Task 12 list also checks). If named differently, adjust import. The xpath `$` form (`'xpath/ancestor::...'`) is puppeteer 24 syntax — verify against an open modal in the dev browser; fall back to scoping the X by re-querying the card's `li` if xpath misbehaves.

- [ ] **Step 3: Syntax check both**

Run: `node --check recommend/resume-inspector.mjs && node --check recommend/actions.mjs`
Expected: OK.

- [ ] **Step 4: Live smoke**

In the dev browser, manually: open resume (confirm `openResume` returns true + `readSummary` non-empty), greet one candidate at tiny budget (confirm `継続沟通`/`继续沟通` detected), X one candidate (confirm card disappears). Use a brand-new throwaway script; do NOT exceed 1–2 actions.

- [ ] **Step 5: Commit**

```bash
git add recommend/resume-inspector.mjs recommend/actions.mjs
git commit -m "feat(recommend): resume inspector + list X/scroll actions"
```

---

## Phase 3 — Orchestrator + wiring

### Task 12: `orchestrator.mjs` (wave loop, budgets, hooks)

**Files:**
- Create: `recommend/orchestrator.mjs`
- Uses: all of the above. Fires existing hooks (`onCandidateListLoaded`, `onCandidateFiltered`, `beforeStartChat`, `afterChatStarted`).

- [ ] **Step 1: Confirm util exports referenced**

Run: `node -e "import('@geekgeekrun/utils/sleep.mjs').then(m=>console.log(Object.keys(m)))"`
Expected: includes `sleep` and `sleepWithRandomDelay` (adjust imports if names differ).

- [ ] **Step 2: Implement the loop**

```js
import { createHumanCursor } from '../humanMouse.mjs'
import { sleepWithRandomDelay } from '@geekgeekrun/utils/sleep.mjs'
import { detectState, selfHeal, STATES } from './page-state.mjs'
import { scrapeCards } from './list-scraper.mjs'
import { cheapPrescore } from './pure/prescore.mjs'
import { ruleFilterList } from './pure/rule-filter.mjs'
import { score } from './scorer.mjs'
import { openResume, assertIdentity, readSummary, greetInModal, closeResume } from './resume-inspector.mjs'
import { rejectFromList, scrollGently } from './actions.mjs'

/**
 * 推荐页波次主循环。
 * @param {import('puppeteer').Page} page
 * @param {() => import('puppeteer').Frame|null} getFrame - 取 recommendFrame
 * @param {object} hooks - tapable hooks（run-core 提供）
 * @param {object} cfg - recommendPage + scoring + rules 合并配置
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
    if (st === STATES.ACCOUNT_BANNED) throw new Error('ACCOUNT_BANNED: recommend loop aborted for account safety')
    if (st === STATES.VERIFY) { await selfHeal(page, frame); await sleepWithRandomDelay(2000, 4000); continue }
    if (st !== STATES.LIST) { await selfHeal(page, frame); continue }
    if (st === STATES.QUOTA_BLOCKED) break

    let cards = (await scrapeCards(frame)).filter((c) => !seen.has(c.encryptGeekId))
    if (hooks?.onCandidateListLoaded) await hooks.onCandidateListLoaded.promise(cards).catch(() => {})
    let wave = cards.filter((c) => c.interactable)
    if (!wave.length) {
      if (budgets.greet <= 0 || budgets.scroll <= 0 || staleWaves >= cfg.maxStaleWaves) break
      await scrollGently(page, cfg); budgets.scroll--; continue
    }
    wave = wave.sort((a, b) => cheapPrescore(b) - cheapPrescore(a)).slice(0, cfg.waveSize)

    let newCount = 0
    for (const c of wave) {
      const pre = ruleFilterList(c, cfg.rules || {})
      if (pre.result === 'reject') {
        if (hooks?.onCandidateFiltered) await hooks.onCandidateFiltered.promise([c], { matched: false, reason: pre.reason }).catch(() => {})
        if (budgets.x > 0) { if (await rejectFromList(page, frame, cursor, c.encryptGeekId, pre.reason)) budgets.x-- }
        seen.add(c.encryptGeekId); newCount++; continue
      }
      if (!await openResume(page, frame, cursor, c.encryptGeekId)) { seen.add(c.encryptGeekId); continue }
      if (!await assertIdentity(frame, c.geekName)) { await closeResume(page, frame, cursor); continue }
      const resume = await readSummary(frame)
      const scored = await score(c, resume, cfg, llmFn)

      if (scored.hardReject) {
        await closeResume(page, frame, cursor)
        if (budgets.x > 0) { if (await rejectFromList(page, frame, cursor, c.encryptGeekId, scored.reason)) budgets.x-- }
      } else if (scored.score >= cfg.minScoreToChat && budgets.greet > 0) {
        if (hooks?.beforeStartChat) await hooks.beforeStartChat.promise(c).catch(() => {})
        const ok = await greetInModal(frame, cursor)
        if (ok) budgets.greet--
        if (hooks?.afterChatStarted) await hooks.afterChatStarted.promise(c, { greeted: ok, score: scored.score }).catch(() => {})
        await closeResume(page, frame, cursor)
      } else {
        await closeResume(page, frame, cursor)
      }
      seen.add(c.encryptGeekId); newCount++
      await sleepWithRandomDelay(cfg.delayBetweenActionsMs?.[0] ?? 1500, cfg.delayBetweenActionsMs?.[1] ?? 4000)
      if (budgets.greet <= 0 && budgets.x <= 0) break
    }
    staleWaves = newCount === 0 ? staleWaves + 1 : 0
    if (budgets.greet <= 0 && budgets.x <= 0) break
  }
}
```

- [ ] **Step 3: Syntax check**

Run: `node --check recommend/orchestrator.mjs`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add recommend/orchestrator.mjs
git commit -m "feat(recommend): wave-loop orchestrator with budgets, hooks, self-heal"
```

---

### Task 13: Wire orchestrator into `index.mjs`

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/index.mjs` (the recommend-phase of `startBossAutoBrowse`)
- Reference: confirm where the current loop calls `parseCandidateList`/`scrollAndLoadMore`; replace that block with `runRecommendLoop`.

- [ ] **Step 1: Read the current recommend phase**

Run: `grep -n "parseCandidateList\|scrollAndLoadMore\|recommendFrame\|getFrame\|startBossAutoBrowse" index.mjs`
Identify the loop block and the existing `getFrame`/config read.

- [ ] **Step 2: Build merged config and call the loop**

Replace the old parse→filter→scroll loop body with:

```js
import { runRecommendLoop } from './recommend/orchestrator.mjs'
import { readConfigFile } from './runtime-file-utils.mjs'
// ...inside startBossAutoBrowse, after login + dismissGovernanceNoticeDialog + recommendFrame ready:
const rc = readConfigFile('boss-recruiter.json') || {}
const filterCfg = readConfigFile('candidate-filter.json') || {}
const cfg = {
  ...(rc.recommendPage || {}),
  ...(rc.scoring || {}),
  rules: filterCfg,
  // defaults if missing
  waveSize: rc.recommendPage?.waveSize ?? 6,
  maxGreetPerRun: rc.recommendPage?.maxGreetPerRun ?? 20,
  maxXPerRun: rc.recommendPage?.maxXPerRun ?? 10,
  maxScrollSteps: rc.recommendPage?.maxScrollSteps ?? 6,
  maxStaleWaves: rc.recommendPage?.maxStaleWaves ?? 2,
  minScoreToChat: rc.scoring?.minScoreToChat ?? 60,
  onScoreError: rc.scoring?.onScoreError ?? 'skip'
}
const getFrame = () => page.frames().find((f) => f.name() === 'recommendFrame') ?? null
await runRecommendLoop(page, getFrame, hooks, cfg /*, wiredLlmFn */)
if (hooks?.onComplete) await hooks.onComplete.promise().catch(() => {})
```

- [ ] **Step 3: Wire the real LLM fn (or leave scoring disabled)**

If `cfg.enabled === false`, pass an `llmFn` that returns `{ score: cfg.minScoreToChat }` (rule-only). Otherwise wire `defaultLlm` against the confirmed `@geekgeekrun/utils` GPT helper (Task 8 Step 1). Pass the chosen fn as the last arg to `runRecommendLoop`.

- [ ] **Step 4: Syntax check + lint**

Run: `node --check index.mjs`
Expected: OK. (No eslint configured in this package; match style manually.)

- [ ] **Step 5: Commit**

```bash
git add index.mjs
git commit -m "feat(recommend): wire wave-loop orchestrator into startBossAutoBrowse"
```

---

### Task 14: Retire aggressive scroll + dead code

**Files:**
- Modify: `candidate-processor.mjs` (mark `scrollAndLoadMore` deprecated/unused), `chat-handler.mjs` (`viewCandidateDetail` no longer called)

- [ ] **Step 1: Confirm no remaining callers**

Run: `grep -rn "scrollAndLoadMore\|viewCandidateDetail" packages/boss-auto-browse-and-chat --include=*.mjs`
Expected: only definitions remain (no live callers after Task 13).

- [ ] **Step 2: Add deprecation headers (keep exports to avoid breaking imports)**

Prepend a `/** @deprecated 推荐页改用 recommend/ orchestrator；保留以防外部引用 */` JSDoc to `scrollAndLoadMore` and `viewCandidateDetail`. Do not delete (out of scope / other entry points may import).

- [ ] **Step 3: Commit**

```bash
git add candidate-processor.mjs chat-handler.mjs
git commit -m "chore(recommend): deprecate aggressive scroll + old detail viewer"
```

---

## Phase 4 — End-to-end smoke (tiny budget, account-safe)

### Task 15: Guarded live smoke run

**Files:**
- Create (throwaway): `recommend/_e2e-smoke.mjs`

- [ ] **Step 1: Write a minimal-budget runner**

```js
// Launch via buildRecruiterLaunchOptions (headless:false), reuse stored login,
// navigate to recommend, build cfg with maxGreetPerRun:1, maxXPerRun:1, maxScrollSteps:1,
// scoring.enabled:false (rule-only, no LLM), then runRecommendLoop with an llmFn returning {score:100}.
```

- [ ] **Step 2: Run once, observe**

Run: `node recommend/_e2e-smoke.mjs`
Expected/observe: greets exactly 1 candidate (button → 继续沟通), X's at most 1, performs at most 1 gentle scroll, exits cleanly. **Watch for any `ACCOUNT_BANNED` throw — if seen, stop and reassess.** Confirm NO scroll-to-bottom occurs.

- [ ] **Step 3: Delete throwaway, final commit**

```bash
rm recommend/_e2e-smoke.mjs
git add -A && git commit -m "test(recommend): account-safe e2e smoke validated (throwaway removed)"
```

---

## Self-Review (completed against spec)

- **Spec §2 selectors** → Task 1 (constant.mjs) + Tasks 9/10/11 use them. ✓
- **§2.2 state machine (incl. ACCOUNT_BANNED vs VERIFY)** → Task 7 (classifier) + Task 9 (detect/selfHeal). ✓
- **§2.4 fuzzy reasons** → Task 2 + used in Task 11 `rejectFromList`. ✓
- **§3 module split** → Tasks 1–12 mirror the file table. ✓
- **§4 wave loop (encryptGeekId, viewport wave, X-last, prescore, stop conditions, staleWaves)** → Task 12. ✓
- **§4 greet-in-modal w/ 继续沟通 verification** → Task 11 `greetInModal`. ✓
- **§5 scorer (gate + LLM + onScoreError)** → Tasks 5, 8. ✓
- **§6 config** → Task 13 Step 2 merge. ✓
- **§7 self-heal / verification / banned abort** → Tasks 9, 12. ✓
- **§9 hooks preserved** → Task 12 fires onCandidateListLoaded/onCandidateFiltered/beforeStartChat/afterChatStarted; Task 13 fires onComplete. ✓
- **§1 G1 no unbounded scroll** → Task 11 `scrollGently` (bounded) is the only scroll; Task 14 retires `scrollAndLoadMore`; Task 15 verifies. ✓
- **Type consistency:** `encryptGeekId`, `{result:'pass'|'reject'|'hardReject'}`, `{score,reason,hardReject}`, `STATES.*`, `cheapPrescore`, `fuzzyReason`, `ruleFilterList`, `mergeScore` — names consistent across tasks. ✓

**Known live-iteration points (flagged, not placeholders):** `defaultLlm` GPT wiring (Task 8 Step 1 / Task 13 Step 3), the X-button xpath ancestor lookup (Task 11 Step 2 note), exact `ACCOUNT_BANNED`/`QUOTA_BLOCKED` strings (spec §10), and the resume-modal name selector for `assertIdentity` (Task 11) — each has a concrete fallback and a live smoke to confirm.
