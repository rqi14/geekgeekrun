# 筛选/评分配置架构 Review 与重构提案

> 范围：招聘端（recruiter）的筛选/评分配置。只读分析 + 设计提案，未改动任何代码。
> 用户痛点：筛选条件散落在 **职位配置（BossJobConfig）** 与 **推荐牛人（RecommendAutomation）** 两个页面，高度重复、归类混乱；同一个 rubric 既被标注"仅沟通页生效"又被标注"同时用于推荐页"，自相矛盾；并出现"沟通页取消了 LLM 但 LLM 仍然跑"的真实 bug。

---

## 1. 现状映射（Current-state map）

### 1.1 配置入口、持久化位置、消费方对照表

设有三个 worker 消费方：
- **R = 推荐牛人 worker**（`recommend/orchestrator.mjs` → `score()` / `ruleFilterList()` / `fieldKnockout()`）
- **C = 沟通页 worker**（`chat-page-processor.mjs`）
- 两者都经由 `runtime-file-utils.mjs#getMergedJobConfig(jobId)` 合并配置。

| 设置项 | UI 入口 | 持久化文件 / 键 | 消费方 | 备注 |
|---|---|---|---|---|
| 期望城市 `expectCityList` | 职位配置 + 推荐牛人「卡片初筛」 | per-job: `boss-jobs-config.json` `jobs[].filter.expectCityEnabled/expectCityList`；全局: `candidate-filter.json` `expectCityList` | R + C（preFilter） | **重复**：两页都能配 |
| 学历正则 `expectEducationRegExpStr` | 职位配置 + 推荐牛人 | 同上（per-job 带 `expectEducationEnabled`） | R + C | **重复** |
| 工作经验 `expectWorkExpRange` | 职位配置 + 推荐牛人 | per-job `expectWorkExpMin/MaxEnabled + expectWorkExpRange`；全局 `expectWorkExpRange` | R + C | **重复** |
| 期望薪资 `expectSalaryRange` + `expectSalaryWhenNegotiable` | 职位配置 + 推荐牛人 | 同上 | R + C | **重复** |
| 技能/优势关键词 `expectSkillKeywords` | **仅推荐牛人**「卡片初筛」 | 全局 `candidate-filter.json` `expectSkillKeywords` | R + C | 职位配置 **无此 UI**（`jobFilterToCandidateFilter` 里读 `f.expectSkillKeywords` 但 BossJobConfig 不写它 → per-job 永远空） |
| 院校 `expectSchoolKeywords` | **仅推荐牛人** | 全局 `expectSchoolKeywords` | R + C | 同上，per-job 缺失 |
| 专业 `expectMajorKeywords` | **仅推荐牛人** | 全局 `expectMajorKeywords` | R + C | 同上，per-job 缺失 |
| 屏蔽姓名 `blockCandidateNameRegExpStr` | **仅推荐牛人** | 全局 `blockCandidateNameRegExpStr` | R + C | 职位配置无 |
| 跳过已看过 `skipViewedCandidates` | 推荐牛人「卡片初筛」+「预算」 | 全局 + `boss-recruiter.json` `recommendPage.skipViewedCandidates` | R（C 不用） | 双写两处 |
| 专业/方向卡片初筛 `fieldRules{include,exclude}` | **仅职位配置**「专业/方向相关性」 | per-job `filter.fieldRules`；回退全局 `candidate-filter.json` `fieldRules` | **R only**（`fieldKnockout`，orchestrator.mjs:139） | 推荐牛人页 **无此 UI** |
| 原生筛选 `nativeFilter` | （无 UI，仅 JSON） | `candidate-filter.json` `nativeFilter` | R only | — |
| 简历关键词 `resumeKeywords(+Enabled)` | **仅职位配置**「简历全文筛选」 | per-job `filter.resumeKeywords/resumeKeywordsEnabled` | **C only**（`mode='keywords'`） | — |
| 简历正则 `resumeRegExp(+Enabled)` | **仅职位配置** | per-job `filter.resumeRegExpEnabled/resumeRegExpStr` | **声称 C，但实际无人消费**：`jobFilterToChatPageFilter` 命中该分支也返回空 keywordList（runtime-file-utils.mjs:234-236），即"全过" | 死配置 |
| **AI Rubric** `resumeLlmConfig{rubric,sourceJd,passThreshold,rubricGenerationModelId}` + `resumeLlmEnabled` | **仅职位配置**「大模型筛选」（完整可视化编辑器） | per-job `filter.resumeLlmEnabled` + `filter.resumeLlmConfig` | **R + C（强耦合，见 §2）** | 核心问题源 |
| 评分总开关 `scoring.enabled` | **仅推荐牛人**「LLM 精排」开关 | `boss-recruiter.json` `scoring.enabled` | R only | 但会被 per-job rubric **强制覆盖**（见 §2） |
| 评分 JD `scoring.jd` | **仅推荐牛人**「职位描述」 | `boss-recruiter.json` `scoring.jd` | R only | 与 per-job `resumeLlmConfig.sourceJd` 是**两份独立 JD** |
| 达标分 `scoring.minScoreToChat` | 推荐牛人「达标分阈值」 | `boss-recruiter.json` `scoring.minScoreToChat` | R only | per-job rubric 存在时被 `passThreshold` 覆盖 |
| 评分失败处理 `scoring.onScoreError` | 推荐牛人 | `boss-recruiter.json` `scoring.onScoreError` | R only | — |
| 评分模型 `scoring.modelId` | 推荐牛人 | `boss-recruiter.json` `scoring.modelId` | R only | 与 per-job `rubricGenerationModelId` 是两份 |
| 预算/节奏（waveSize / maxGreetPerRun / 各种延迟…） | 推荐牛人「预算&节奏」 | `boss-recruiter.json` `recommendPage.*` | R only | 与筛选无关，归类正确 |

### 1.2 关键合并逻辑：`getMergedJobConfig(jobId)`（runtime-file-utils.mjs:240-297）

这是"散落"的真正汇聚点。当带 `jobId` 运行时：

1. `candidateFilter = jobFilterToCandidateFilter(jobFilter)` — per-job 的 `expect*` 字段（按 `*Enabled` 决定是否生效）转成 candidate-filter 形状，供 R 的 `ruleFilterList` 和 C 的 `preFilter`。
2. `candidateFilter.fieldRules = jobFilter.fieldRules ?? 全局` — 卡片初筛词。
3. `chatPageFilter = jobFilterToChatPageFilter(jobFilter)` — **只看 `resumeLlmEnabled` / `resumeKeywordsEnabled`**，产出 `chatPage.filter.{mode,keywordList,llmRule,llmConfig}` 供 C。
4. **rubric 同源到推荐评分**（runtime-file-utils.mjs:267-281）：
   ```js
   const hasJobRubric =
     jobFilter?.resumeLlmEnabled &&
     llm?.rubric?.dimensions?.length > 0
   const scoring = hasJobRubric
     ? { enabled: true, rubric: {...llm.rubric, passThreshold: llm.passThreshold},
         minScoreToChat: llm.passThreshold ?? ..., modelId: ... }
     : recruiterConfig.scoring   // 回退推荐牛人页面板的 scoring
   ```
   即：**只要职位勾了 `resumeLlmEnabled` 且 rubric 有维度，就强制 `scoring.enabled = true`**，完全无视推荐牛人页「LLM 精排」开关（`boss-recruiter.json scoring.enabled`）。

### 1.3 两个 worker 如何各自消费

- **推荐 R**（`run-config.mjs#buildRecommendCfgAndLlm`）：读 `config.scoring`。`scoring.enabled` 真 → 用 `scoring.rubric`（来自 per-job）或用 `scoring.jd` 现场生成 rubric；假 → `recLlmFn` 直接给固定分 = 仅规则初筛。`minScoreToChat` 取 `scoring.minScoreToChat`，但当 rubric 自带 `passThreshold` 且用户未显式配 minScore 时用 `passThreshold`（run-config.mjs:49-52）。
- **沟通 C**（`chat-page-processor.mjs:330-334, 662-681`）：读 `chatPage.filter`。`mode==='llm'` 且 `llmConfig.rubric` → 走 `evaluateResumeByRubric`；`mode==='keywords'` → 关键词；其余 → 默认通过。`mode` 完全由 `jobFilterToChatPageFilter` 依据 `resumeLlmEnabled` 决定。

---

## 2. 问题清单（Problems）

### P1 — 矛盾的帮助文案（用户原始投诉）
职位配置「简历全文筛选」整段标 `仅沟通页生效，推荐牛人页不使用此项`（index.vue:196），但该段内部的「大模型筛选（AI Rubric）」又标 `此 Rubric 同时用于推荐牛人页精评`（index.vue:238-240）。两句话直接冲突。事实是：**段内的关键词/正则确实只给沟通页；唯独 rubric 例外，会同时驱动推荐页**。文案把"整段 chat-only"的标签贴在了一个"其中 rubric 是 shared"的容器上。

### P2 — `resumeLlmEnabled` 一个开关同时控制两个用途（核心耦合 / 真实 bug 根因）
`resumeLlmEnabled` 是 per-job 单一布尔。它在 `getMergedJobConfig` 里被读两次：
- 喂 C：`jobFilterToChatPageFilter` → `mode='llm'`（runtime-file-utils.mjs:219）。
- 喂 R：`hasJobRubric` → `scoring.enabled=true`（runtime-file-utils.mjs:270-272）。

**用户报告的 bug**："在沟通取消了 LLM 筛选，但 LLM 仍然跑了"。两种最可能的成因，都源于这个耦合：

1. 用户去 **推荐牛人页**「LLM 精排」关掉了 `scoring.enabled`，但只要 per-job 仍勾着 `resumeLlmEnabled` 且 rubric 有维度，`getMergedJobConfig` 就用 `hasJobRubric` 把 `scoring.enabled` 强行改回 `true`（runtime-file-utils.mjs:272）——推荐页的关闭开关被 per-job 静默覆盖，LLM 照跑。
2. 反向地，用户以为在"沟通页"语境关掉了 LLM，但实际 C 的 LLM 与否 **只看 per-job `resumeLlmEnabled`**，推荐牛人页根本没有"沟通页 LLM 开关"；唯一的关闭点在职位配置的 `resumeLlmEnabled` 复选框，而那个复选框一旦取消，会**连带**把推荐页评分也关掉（除非 `recruiterConfig.scoring.enabled` 另外开着）。用户无法只关一边。

无论哪条路径，结论一致：**没有"推荐评分启用"与"沟通 LLM 筛选启用"两个独立开关**，两者由 `resumeLlmEnabled` + `scoring.enabled` 以非直觉的优先级纠缠，导致关不掉 / 关错。

### P3 — 同一类配置在两页重复
§1.1 表中标"重复"的 6 项（城市/学历/经验/薪资）在职位配置与推荐牛人「卡片初筛」都能配。运行时 `getMergedJobConfig`：带 jobId → 用 per-job（推荐牛人页面板被忽略）；不带 jobId → 用全局 `candidate-filter.json`（即推荐牛人页保存的值）。**用户无法从 UI 看出哪份生效**，取决于运行时是否选了职位。

### P4 — 同类配置在两页"分裂"且互不可见
- `fieldRules`（卡片初筛词）只在 **职位配置**；`expectSkillKeywords/School/Major`、`blockCandidateNameRegExpStr` 只在 **推荐牛人**。这些都是"卡片初筛"性质的同类设置，却被拆到两页，且彼此不知道对方存在。
- per-job 的 `jobFilterToCandidateFilter` 会去读 `f.expectSkillKeywords` 等（runtime-file-utils.mjs:196-198），但 BossJobConfig 根本不写这些字段 → **per-job 运行时这些卡片初筛词恒为空**，只有不带 jobId（全局）时才有值。隐性数据丢失。

### P5 — 两份 JD / 两份 modelId / 两份 passThreshold
- JD：推荐页 `scoring.jd` vs per-job `resumeLlmConfig.sourceJd` —— 各填各的，rubric 来源不一致。
- 阈值：推荐 `scoring.minScoreToChat` vs rubric `passThreshold`，优先级在 run-config.mjs:49-52 隐式决定。
- 模型：`scoring.modelId` vs `rubricGenerationModelId`。
用户改了一处不会同步另一处，"哪个生效"再次不可预测。

### P6 — 死配置 `resumeRegExpEnabled`
职位配置暴露"正则表达式匹配"且可保存，但 `jobFilterToChatPageFilter` 命中该分支返回空 keywordList（"全部通过"，runtime-file-utils.mjs:234-236）。用户配了等于没配，且 UI 无任何提示。

### P7 — rubric 编辑器只在职位配置，推荐页只有半截
推荐页 ScoringTab 自己注明"完整可视化 rubric 编辑仍在职位配置"（ScoringTab.vue:48），但推荐页又能独立填 JD/阈值/模型并存进 `boss-recruiter.json scoring`。于是 rubric 的"真身"在 A 页、"影子参数"在 B 页，编辑分散。

---

## 3. 重构提案（Proposed architecture）

设计原则：**rubric 单一真源；按"共享 / 推荐专属 / 沟通专属"三类清晰分区；推荐评分与沟通 LLM 各自独立开关**。优先增量改造，不做大重写。

### 3.1 配置模型（持久化形状）

以 **per-job（`boss-jobs-config.json` `jobs[].filter`）为筛选/评分的唯一真源**，全局 `candidate-filter.json` / `boss-recruiter.json scoring` 降级为"未选职位时的兜底"（保留现有回退链，不破坏旧数据）。

把 `jobs[].filter` 重组为三块（字段名尽量沿用，降低迁移成本）：

```jsonc
{
  "filter": {
    // ── A. 共享：硬性卡片初筛（推荐 + 沟通 preFilter 都用） ──
    "preFilter": {
      "expectCityEnabled": false, "expectCityList": [],
      "expectEducationEnabled": false, "expectEducationRegExpStr": "",
      "expectWorkExpMinEnabled": false, "expectWorkExpMaxEnabled": false, "expectWorkExpRange": [0,99],
      "expectSalaryMinEnabled": false, "expectSalaryMaxEnabled": false, "expectSalaryRange": [0,0],
      "expectSalaryWhenNegotiable": "exclude",
      "expectSkillKeywords": [], "expectSchoolKeywords": [], "expectMajorKeywords": [],
      "blockCandidateNameRegExpStr": "",
      "fieldRules": { "include": [], "exclude": [] }   // 卡片专业/方向相关性
    },

    // ── B. 共享真源：AI Rubric（推荐评分 + 沟通 LLM 筛选共用同一份 rubric） ──
    "rubric": {
      "sourceJd": "", "modelId": null,
      "passThreshold": 75,
      "knockouts": [], "dimensions": []
    },

    // ── C. 推荐专属 ──
    "recommend": {
      "scoringEnabled": false,           // 推荐页是否做 LLM 精评（独立开关！）
      "minScoreToChat": 0,               // 不填则回退 rubric.passThreshold
      "onScoreError": "skip",
      "skipViewedCandidates": false
    },

    // ── D. 沟通专属 ──
    "chat": {
      "llmFilterEnabled": false,         // 沟通页是否用 rubric 做简历筛选（独立开关！）
      "keywordsEnabled": false, "keywords": [],
      "regexEnabled": false, "regex": ""  // 实现后再放开；当前禁用并标注"暂未支持"
    }
  }
}
```

要点：
- **rubric 抽到独立的 `filter.rubric`，只此一份**（消灭 P5/P7）。推荐与沟通都引用它。
- **两个独立 enable**：`recommend.scoringEnabled` 与 `chat.llmFilterEnabled`，互不影响（消灭 P2 的真实 bug）。`resumeLlmEnabled` 单开关被拆成两个。
- A 块把当前散落于两页的卡片初筛全部归一到 per-job（消灭 P3/P4），全局 `candidate-filter.json` 仅作未选职位时兜底。

### 3.2 UI 落位（合并到一个页面 + 清晰分区）

推荐做法：**以「职位配置」为筛选/评分的主页面**（它已是 per-job 粒度、已有 rubric 编辑器），把推荐牛人页的"卡片初筛 / 职位&评分"中**与筛选/评分相关**的部分迁入，按以下分区呈现：

1. **「卡片初筛（推荐 + 沟通 均生效）」** — A 块全部字段。把推荐页 `CardFilterTab` 的 skill/school/major/blockName 搬进来，与现有 city/edu/exp/salary、fieldRules 合并成一个区。
2. **「AI 评分标准（Rubric · 唯一真源）」** — B 块。现有可视化编辑器 + JD + 模型 + passThreshold。明确文案："此 Rubric 为评分唯一来源，被下方推荐评分与沟通筛选共用。"
3. **「推荐牛人页行为」** — C 块：`scoringEnabled`（开关："推荐页开简历后用上面的 Rubric 精评")、minScore、onScoreError、skipViewed。
4. **「沟通页行为」** — D 块：`llmFilterEnabled`（开关："沟通页用上面的 Rubric 筛选简历")、keywords、(regex 暂禁)。

推荐牛人页（RecommendAutomation）**保留为"运行 + 预算/节奏 + 执行"**面板（`BudgetTab`/`RunTab` 与筛选无关，归类本就正确），其 ScoringTab/CardFilterTab 退化为只读摘要或直接移除，跳转链接到职位配置。这样"去哪配筛选"只有一个答案。

> 若不想动两页结构，**最小方案**：保持两页，但 (a) rubric 仅在职位配置可编辑，推荐页只显示"已引用 per-job rubric"；(b) 推荐页两个 enable 开关分别绑定 `recommend.scoringEnabled` 与（如需）`chat.llmFilterEnabled`，文案讲清各自作用域。

### 3.3 运行时合并改造（`getMergedJobConfig`）

把 runtime-file-utils.mjs:267-281 的"rubric 强制 enabled"改为读独立开关：

```js
const rubric = jobFilter?.rubric
const hasRubric = Array.isArray(rubric?.dimensions) && rubric.dimensions.length > 0

// 推荐评分：只看 recommend.scoringEnabled，不再用 resumeLlmEnabled 强制
const scoring = jobFilter?.recommend?.scoringEnabled
  ? { enabled: true, rubric, minScoreToChat: jobFilter.recommend.minScoreToChat ?? rubric?.passThreshold ?? 0,
      onScoreError: jobFilter.recommend.onScoreError ?? 'skip', modelId: rubric?.modelId ?? null }
  : recruiterConfig.scoring   // 兜底

// 沟通筛选：只看 chat.llmFilterEnabled
const chatPageFilter = jobFilter?.chat?.llmFilterEnabled && hasRubric
  ? { mode: 'llm', keywordList: [], llmRule: rubric.sourceJd || '', llmConfig: { rubric, passThreshold: rubric.passThreshold } }
  : jobFilter?.chat?.keywordsEnabled
    ? { mode: 'keywords', keywordList: jobFilter.chat.keywords || [], llmRule: '', llmConfig: null }
    : { mode: 'keywords', keywordList: [], llmRule: '', llmConfig: null }
```

两个 worker（`buildRecommendCfgAndLlm`、`chat-page-processor`）的消费侧无需改动——它们仍各读 `config.scoring` 与 `config.chatPage.filter`，只是上游不再耦合。

### 3.4 迁移路径（一次性、幂等，仿照已有 `migrateToV2`）

在 `readBossJobsConfig()` 内加 `migrateJobFilter(filter)`（纯函数、幂等）：
- 旧 `expect*Enabled/expect*` + `fieldRules` → `filter.preFilter.*`（直接搬键）。
- 旧 `resumeLlmConfig{rubric,sourceJd,passThreshold,rubricGenerationModelId}` → `filter.rubric`（`rubricGenerationModelId`→`modelId`）。
- 旧 `resumeLlmEnabled` → **同时**置 `recommend.scoringEnabled = resumeLlmEnabled`（保持旧"二合一"行为不回归）**且** `chat.llmFilterEnabled = resumeLlmEnabled`。用户随后可分别关闭。
- 旧 `resumeKeywords(+Enabled)` → `chat.keywords/keywordsEnabled`。
- `resumeRegExp*` → `chat.regex*` 但 UI 标"暂未支持"，运行时仍 no-op（与现状一致，不算回归）。
- 读取时若检测到旧形状即迁移并原子写回（已有 `atomicWrite` 可复用），保留未知字段。

全局 `candidate-filter.json` / `boss-recruiter.json scoring` 形状不变，继续作为"未选职位"兜底，旧用户零感知。

---

## 4. 速赢（Quick wins，重构前即可做）

1. **修正矛盾文案（P1）**：把职位配置「简历全文筛选」段的整段 tag `仅沟通页生效，推荐牛人页不使用此项`（index.vue:196）改为 `关键词/正则仅沟通页生效；下方 AI Rubric 同时用于推荐页评分`，与 rubric 行的 tag（index.vue:238-240）口径统一，消除自相矛盾。

2. **解耦推荐评分开关被 per-job 静默覆盖（P2，直接修 bug）**：runtime-file-utils.mjs:270-272 的 `hasJobRubric` 增加一个尊重用户意图的条件——当 `recruiterConfig.scoring.enabled === false` 时不要强制 `enabled:true`，或新增 per-job `recommend.scoringEnabled` 开关优先。最小改动：把 `hasJobRubric` 改为 `jobFilter.resumeLlmEnabled && hasRubric && recruiterConfig.scoring?.enabled !== false`，让推荐页的关闭开关重新可用。

3. **给死配置加提示或禁用（P6）**：职位配置「正则表达式匹配」（index.vue:222-234）当前对沟通页是 no-op。要么禁用该复选框并标注"暂未支持，敬请期待"，要么在 `jobFilterToChatPageFilter` 真正实现 regex 模式（沟通侧 `mode==='keywords'` 处增加 regex 分支）。先做禁用+提示成本最低。

4. **补齐 per-job 卡片初筛字段读写一致性（P4）**：`jobFilterToCandidateFilter` 已读 `expectSkillKeywords/School/Major`、`blockCandidateNameRegExpStr`（runtime-file-utils.mjs:196-200）但 BossJobConfig 不写它们 → per-job 恒空。短期把这几个输入框补进职位配置的"卡片初筛"区（与现有 `fieldRules` 同区），即可消除"选了职位反而这些初筛失效"的隐性丢失。
