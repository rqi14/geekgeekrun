# 推荐牛人自动化 · 配置 Tab UI 重设计 (Design)

> 状态：自主设计（用户离开，要求 "design the tab ui from zero … ready to use code"，follow best practice + codex 评审）。本文档记录决策与**假设**，用户回来可据此纠偏。

**Goal:** 用一个流程对齐(flow-aligned)的标签页配置界面，取代当前散落在 8 个页面、读写 5 个 JSON、字段重复且与自动化流程不对应的招聘端推荐牛人配置体验。

**Architecture:** 新增一个自包含页面 `RecommendAutomation`(Vue 3 `<script setup>` + element-plus + UnoCSS)，按波次主循环(wave-loop)的真实阶段分 4 个 Tab。它**只读写现有配置文件、复用现有 IPC**，对主进程/后端零改动(除两处小而安全的 additive 补丁)。**采取增量、可回退策略**：新页面作为推荐牛人配置的主入口接进导航，旧页面保留(降级在导航中)，互不破坏，用户可在真站点上 A/B 对比。

**Tech Stack:** Electron + Vue 3 + TypeScript + element-plus ^2.8.4 + UnoCSS；配置经 `fetch-boss-recruiter-config-file-content` / `save-boss-recruiter-config` IPC 落到 `~/.geekgeekrun/config/boss-recruiter.json` 与 `candidate-filter.json`。

---

## 1. 为什么重做(现状问题)

招聘端推荐牛人相关配置当前散落在 `BossJobConfig` / `BossAutoBrowseAndChat` / `BossChatPage` / `BossAutoSequence` 四个页面，外加 `BossLlmConfig`：
- **不对应流程**：用户看不到"卡片初筛 → 开简历评分 → 按分打招呼/X"这条线；筛选条件、评分、预算、执行被切碎在不同页面。
- **字段重复**：城市/学历/薪资/年限筛选在 `BossJobConfig`(per-job，带 `*Enabled` 后缀)与 `candidate-filter.json`(global，扁平)两套 schema 重复。
- **新能力无处配**：刚加的卡片层 `expectSchoolKeywords` / `expectMajorKeywords` 在任何页面都没有入口。
- **账号安全**没有被显著前置(此前激进滚动导致封号，见 `memory/recommend-scroll-ban.md`)。

## 2. 配置契约(orchestrator 实际读取 — 不可改键名)

来源 `packages/boss-auto-browse-and-chat/index.mjs:400-455`(global 路径，jobId 为空)。新 UI **必须**写这些键：

**`candidate-filter.json`(= orchestrator 的 `recCfg.rules`，被 `filterCandidates` 读取)：**
- `expectCityList: string[]`
- `expectEducationRegExpStr: string`(或 `expectEducationList: string[]`)
- `expectWorkExpRange: [number, number]`
- `expectSalaryRange: [number, number]` + `expectSalaryWhenNegotiable: 'exclude'|'include'`
- `expectSkillKeywords: string[]`
- `expectSchoolKeywords: string[]` ← 新；命中学校名(schools)或档次标签(tags 如 双一流/QS前500院校)
- `expectMajorKeywords: string[]` ← 新；命中专业(majors)
- `blockCandidateNameRegExpStr: string`
- `skipViewedCandidates: boolean`

**`boss-recruiter.json`：**
- `recommendPage`: `waveSize`(默认6) `maxGreetPerRun`(默认=autoChat.maxChatPerRun) `maxXPerRun`(默认10) `maxScrollSteps`(默认6) `maxStaleWaves`(默认2) `scrollDelayMsRange`(默认[800,2000]) `delayBetweenActionsMs`(默认[1500,4000]) `clickNotInterestedForFiltered`(默认true) `runOnceAfterComplete` `rerunIntervalMs` `delayBetweenNotInterestedMs`(默认[800,2500]) `skipViewedCandidates` `keepBrowserOpenAfterRun`
- `scoring`: `enabled: boolean` `jd: string` `rubric?: object` `minScoreToChat: number`(默认0) `onScoreError: 'skip'|'greetIfRulePass'`(默认skip) `modelId?: string|null`
- `autoChat`: `greetingMessage` `maxChatPerRun` `delayBetweenChats`
- `advanced.persistProfile: boolean`、`logLevel`

## 3. 后端需要的补丁(small, additive, tested) — 含 codex 评审修正

1. **`save-boss-recruiter-config` IPC**(`packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts:954`)：现仅透传 8 个 candidate-filter 字段，**不含** `expectSchoolKeywords` / `expectMajorKeywords`，且**没有 `scoring` 透传**。补：用 `hasOwn` 守卫追加这两个 filter 字段到 `candidate-filter.json`，并把 `payload.scoring` 合并进 `bossRecruiterConfig.scoring`(scoring 由 index.mjs 从 `boss-recruiter.json` 读，**必须落 boss-recruiter.json**)。纯追加，不动既有键。
2. **`jobFilterToCandidateFilter`**(`runtime-file-utils.mjs:165`)：per-job 模式硬编码丢弃 `expectSkillKeywords` / `blockCandidateNameRegExpStr` / `skipViewedCandidates`，且从不映射 school/major。补：透传**所有** candidate-filter 键(skills / school / major / blockName / skipViewed)，带 `*Enabled` 则按开关、否则原样回退。附单测。防止 per-job 静默丢字段。
3. **`runRecommendLoop` 的 `clickNotInterestedForFiltered` 守卫**(`recommend/orchestrator.mjs:64-70`、`95`)：当前对初筛/hardReject 拒绝者**只要 X 预算>0 就无条件 X**。`recommendPage.clickNotInterestedForFiltered` 与 `delayBetweenNotInterestedMs` 这两个旧键在新 loop 里是**死键**(codex #4)。补：在两处 `rejectFromList` 前加 `if (cfg.clickNotInterestedForFiltered === false) { seen.add; continue }` 守卫(不点 X，仅跳过)。附单测。`delayBetweenNotInterestedMs` **不在 UI 暴露**(X 已被 `delayBetweenActionsMs` 节流，冗余)。

> **假设/已知限制(codex #2/#5 修正)**：
> - orchestrator 的 `recCfg.rules` 来自**两条路径**：① **recommend-only 单跑**(`run-boss-recommend` → 无 jobId)走 **global** `candidate-filter.json` —— 本页字段在此路径**直接生效**；② **组合/顺序执行**(`BOSS_AUTO_BROWSE_AND_CHAT_MAIN` 对每个启用的 sequence job 传 `jobId`)走 `getMergedJobConfig(jobId)` → 用 per-job filter **替换** global。
> - 因此本页加 **sequence-mode 守卫**：加载时读 `boss-jobs-config.json`，若存在"启用的 sequence job"，在页顶显示 `el-alert`：本页(global)筛选仅对"推荐牛人单跑"生效；顺序执行模式下由 per-job 配置(旧 `BossJobConfig`)决定(配合补丁 2，school/major 不再被丢)。
> - `recommendPage.runOnceAfterComplete` / `rerunIntervalMs` / `keepBrowserOpenAfterRun` 仅 **recommend-only 单跑**(`BOSS_RECOMMEND_MAIN`)读取；组合 worker 不读。UI 中归入"推荐牛人单跑生效"分组并标注。
> - 统一 per-job 与 global 两套 filter schema 留作后续(范围太大，不在本次)。

## 4. 页面结构 — 4 个 Tab 对应流程阶段

页面 `page/MainLayout/RecommendAutomation/index.vue`，顶部 `el-tabs`(card 风格)，底部固定操作条(保存 / 保存并运行 / RunningOverlay)。一次加载、统一一个 `reactive` 配置对象，保存时拆成 IPC payload。

```
┌─ 推荐牛人 · 自动化配置 ───────────────────────────────┐
│ [① 职位&评分] [② 卡片初筛] [③ 预算&节奏] [④ 执行]      │
│ … 当前 Tab 内容 …                                      │
├───────────────────────────────────────────────────────┤
│ 流程提示: 卡片初筛(省点击) → 开简历LLM精排 → 按分打招呼 │
│                              [仅保存] [保存并运行 ▶]    │
└───────────────────────────────────────────────────────┘
```

### Tab ① 职位 & 评分 (Stage B/C — 开简历后)
- `scoring.jd`(JD 文本域，驱动 rubric 自动生成)
- `scoring.enabled` 开关：关 = 规则-only(过卡片初筛即按阈值打招呼)；开 = LLM 精排
- `scoring.minScoreToChat`(达标分阈值)、`scoring.onScoreError`(LLM 失败时：skip / greetIfRulePass)
- `scoring.modelId`(从 `boss-fetch-llm-config` 拉启用模型下拉；空=用 purpose 默认)
- 说明 + 跳转链接：LLM 供应商在 `BossLlmConfig`、登录凭据在登录入口(不在本页重做)
- rubric：v1 运行时由 JD 自动生成(`generateRubricFromJd`)，无需在此可视化编辑；保留"预览生成结果"为**可选**只读展示。完整 rubric 可视化编辑仍走旧 `BossJobConfig`(链接过去)。

### Tab ② 卡片初筛 (Stage A — 不开简历，最省动作、最安全)
复用统一的 `FilterRuleRow`(启用开关 + 标签 + 输入槽 + 帮助文字)。每条对应 candidate-filter 一个字段：
- 城市 `expectCityList`(逗号/标签输入)
- 学历 `expectEducationRegExpStr`(正则，给常用快填：本科+ / 硕士+ / 博士)
- 工作年限 `expectWorkExpRange`(双数字)
- 期望薪资 `expectSalaryRange` + `expectSalaryWhenNegotiable`(面议 include/exclude)
- 关键词(优势) `expectSkillKeywords`
- **院校 `expectSchoolKeywords`** ← 新；提示"可填 双一流/QS/985/211 档次标签 或 具体学校名；缺数据按未命中"
- **专业 `expectMajorKeywords`** ← 新
- 屏蔽姓名 `blockCandidateNameRegExpStr`(正则)
- 跳过已看过 `skipViewedCandidates`
- 顶部一句话：命中初筛即直接 X，**省下一次开简历**(可疑动作更少)。

### Tab ③ 预算 & 节奏 (账号安全 — 显著前置)
- `recommendPage.maxGreetPerRun`(每轮打招呼上限)、`maxXPerRun`(每轮 X 上限)
- `recommendPage.maxScrollSteps`(滚动步数上限，**唯一滚动点**)、`maxStaleWaves`、`waveSize`
- `recommendPage.scrollDelayMsRange`、`delayBetweenActionsMs`、`delayBetweenNotInterestedMs`(双滑块/双数字)
- `autoChat.greetingMessage`(招呼语)、`autoChat.maxChatPerRun`
- 顶部醒目 `el-alert`(warning)：从前激进滚动导致封号；这些上限是自我约束，**调小更安全**。

### Tab ④ 执行
- `recommendPage.clickNotInterestedForFiltered`(对初筛拒绝者是否点不感兴趣；关=只跳过不 X)——**靠补丁 3 在 loop 内生效**
- 分组「仅推荐牛人单跑生效」(标注)：`recommendPage.runOnceAfterComplete` + `rerunIntervalMs`、`keepBrowserOpenAfterRun`
- `advanced.persistProfile`(带风险说明)
- sequence-mode 守卫 `el-alert`(见 §3)：检测到启用的 sequence job 时提示 global 筛选仅单跑生效
- 操作：`run-boss-auto-browse-and-chat` / `stop-...`，`RunningOverlay` 显示状态。
- (不暴露 `delayBetweenNotInterestedMs`——新 loop 不读，X 已由 `delayBetweenActionsMs` 节流)

## 5. 组件拆分(每文件单一职责)

- `RecommendAutomation/index.vue` — 页面外壳：tabs + 统一 state 装载/保存 + 操作条。
- `RecommendAutomation/ScoringTab.vue`、`CardFilterTab.vue`、`BudgetTab.vue`、`RunTab.vue` — 四个 Tab，纯展示，props 双向绑 state 切片，emit change。
- `RecommendAutomation/FilterRuleRow.vue` — 通用"开关+标签+输入槽+帮助"行(DRY 卡片初筛 8 条)。
- `RecommendAutomation/useRecommendConfig.ts` — composable：load(把两个 JSON 归一成统一 state)/save(拆回 IPC payload)/默认值。装载与保存集中一处，避免各页重复 onMounted 模式。

## 6. 数据流

```
useRecommendConfig.load()
  ← fetch-boss-recruiter-config-file-content() → { 'boss-recruiter.json', 'candidate-filter.json' }
  → 归一为 reactive state（含默认值回填）
[用户编辑各 Tab，双向绑定 state]
useRecommendConfig.save()
  → 拆成 save-boss-recruiter-config 的扁平 payload（recommendPage/scoring/autoChat/advanced + candidate-filter 各键）
  → IPC 写两个 JSON
"保存并运行" → save() 后 run-boss-auto-browse-and-chat()
```

## 7. 错误处理 & 校验

- 加载失败：el-message 报错 + 用默认值兜底(不空白)。
- 保存：await 两个写文件，成功 el-message success，失败保留编辑态并提示。
- 校验：正则字段 try `new RegExp()` 即时提示；数字范围 min≤max；薪资非负；阈值 0–100。
- "保存并运行"前若 `scoring.enabled` 但既无 rubric 又无 jd → 提示将回退规则-only(与 orchestrator 行为一致)。

## 8. 测试策略

- **纯逻辑(node:test，零新依赖)**：`useRecommendConfig` 的 load/save 纯函数化为 `normalizeConfig(raw)` 与 `toSavePayload(state)`，对其写单测(默认回填、键名映射、数组↔字符串、范围裁剪)。
- **后端补丁**：`jobFilterToCandidateFilter` 透传 school/major/skills 的单测；`save-boss-recruiter-config` 的 school/major/scoring 透传(若可在 node 环境对 handler 解耦测，否则手验)。
- **typecheck + build**：`pnpm -F geekgeekrun-ui typecheck` 与 `build` 必须过(渲染层无法无头真跑，用编译期 + 类型作强校验)。
- **live**：用户回来在真站点小额度跑(`maxGreetPerRun=1` 等)验证保存的键确实驱动了 orchestrator。

## 9. 不在本次范围(YAGNI / 避免破坏)

- 不重写 `BossLlmConfig`(供应商/模型管理)、`WebhookIntegration`、`BossConfigManager`、`BossDebugTool` — 各自独立、能用、非"流程"。
- 不删旧页面、不改导航主结构(只新增入口)。
- 不统一 per-job 与 global 两套 filter schema(仅打补丁防止 per-job 丢新字段)。
- 不引入 Pinia / Zod / i18n 等新依赖。

## 10. 自主决策清单(供用户纠偏)

1. **4 Tab 而非 5**：把"职位"和"评分"合并(JD↔rubric 紧耦合)。
2. **增量非替换**：新页面 + 保留旧页面，零破坏、可回退。若你想直接替换，回来说一声即可删旧页/改导航。
3. **走 global 配置路径**(不指定 jobId)。若你主要用 per-job 队列，需要把本页字段接到 `boss-jobs-config.json`(后续)。
4. **rubric 不在本页可视化编辑**(JD 驱动自动生成；可视化编辑仍在旧 `BossJobConfig`)。
