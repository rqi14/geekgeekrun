# 推荐牛人 · 选人 Sequence 设计（结合 LLM rubric）

> 目的：把「识别 → 筛选 → 打招呼/不合适」的实际顺序讲清楚，并说明 LLM rubric
> 应该插在哪一环、与规则门如何分工。配合 `recommend/orchestrator.mjs` 阅读。

## 核心原则：成本递增漏斗（cost-ordered funnel）

每个候选人身上花的代价从低到高排：**免费文本 → 一次点击读简历 → 一次 LLM 调用 →
一次会消耗额度/触发风控的动作**。越贵的判断越靠后，且只对「通过了所有更便宜的
关卡、并且还有额度」的候选人执行。这样：

- LLM 只评估值得评估的人（省 token / 省钱）。
- 打招呼额度（`maxGreetPerRun`，最稀缺资源）花在最可能优的人身上。
- 风控/封号是不可逆的，所以每一步前都重新确认页面状态。

## Sequence（七层）

| Tier | 名称 | 成本 | 动作 | 现状 |
|------|------|------|------|------|
| 0 | 状态闸 | 免费 | `detectState`；非 LIST（验证/封号/限额）→ 暂停/自愈/中止，**绝不在风控浮层上盲点** | ✓ 循环级 + 逐候选级双检 |
| 1 | 识别 | 免费 | `scrapeCards` 读列表 DOM；按 `encryptGeekId` 去重 | ✓ |
| 2 | 列表规则初筛 | 免费 | `ruleFilterList`（仅列表可见字段：学历正则、屏蔽姓名、城市、经验、薪资带）→ reject 则按 `shouldClickX` 点「不合适」 | ✓ |
| 3 | 便宜预排序 | 免费 | `cheapPrescore` 把幸存者 best-first 排序，截到 `waveSize` | ✓ |
| 4 | 开简历 + 身份 + 硬门 | 1 次点击 | `openResume → assertIdentity → readSummary`，再 `ruleGate`（列表+简历合并后的确定性硬门）→ hardReject 则点「不合适」 | ✓ |
| 5 | LLM rubric | 1 次 LLM 调用（$$） | `evaluateResumeByRubric`：knockouts（二元淘汰）→ 加权 dimensions → `totalScore` | ✓ |
| 6 | 决策动作 | 消耗额度 | `score ≥ minScoreToChat` 且有额度 → 打招呼；hardReject → 不合适；否则关闭（中性跳过） | ✓ |

**关键效率规则（已实现）**：当 `greet` 额度耗尽时，过了初筛的人**直接跳过、不开简历**
——因为他们只能通过打招呼消费，开简历评分纯属浪费 token。

## 规则门 vs Rubric：两层 knockout 的分工

系统里有**两处** knockout，必须分清职责，否则会重复花钱：

- **规则 knockout（Tier 2/4，免费/便宜，确定性）**：能用字段/正则判定的硬条件
  —— 学历、薪资带、城市、年限。放在 LLM **之前**，能淘汰的绝不留给 LLM。
- **Rubric knockout（Tier 5，LLM，语义判断）**：只有读懂简历才能判的硬条件
  —— 「必须有 XX 领域项目经验」「必须带过团队」。这类才值得花一次 LLM 调用。

> **生成 rubric 时的准则**：`generateRubricFromJd` 应把*确定性*条件下沉到规则配置
> （便宜层），只把*语义*条件留在 rubric.knockouts。否则就是花 LLM 的钱做正则能做的事。

## 三个待改进点（current 已很接近理想漏斗，以下是收尾）

### 1. 双阈值打架：`minScoreToChat` vs `rubric.passThreshold`
`evaluateResumeByRubric` 同时算出 `totalScore` 和 `isPassed`（对比自带的
`passThreshold`），但 `scorer.mjs` 只取 `totalScore` 去和 `cfg.minScoreToChat` 比，
**丢弃了 `isPassed`**。两个阈值可能不一致，令人困惑。
**建议**：单一事实来源——生成 rubric 时令 `passThreshold = minScoreToChat`，
或直接在 scorer 用 `isPassed` 做门、弃用 `minScoreToChat`。

### 2. 失败方向要一致：fail-closed
- `scorer.mjs` 里 LLM 抛错 → `llm = null` → `mergeScore` 按 `onScoreError`：
  默认 `skip`（`minScoreToChat - 1` → **不打招呼**）。✓ 对付费动作是安全的。
- 但 `evaluateResumeByRubric` **自身**失败时默认 `isPassed: true / "默认通过"`。
  方向相反。当前因为 scorer catch 成 null 覆盖掉了它，所以没出事，但这是隐患。
**建议**：招聘端是「花钱+有风控」的动作，统一 **fail-closed**（出错不打招呼）。
把 rubric 内部的默认改成不通过，或明确注释它会被 scorer 覆盖。

### 3. 预排序对齐 rubric 权重（nice-to-have）
`cheapPrescore` 现在写死（学历、985/211 标签、活跃度）。若某 JD 的 rubric 把
「活跃度」权重压低、「项目经验」权重抬高，预排序的顺序就和 LLM 最终偏好不一致，
可能先把额度花在 prescore 高但 rubric 低的人身上。
**建议**：从 rubric 里**列表可见**的高权重维度派生一个轻量 prescore，让 Tier 3 的
排序方向和 Tier 5 的奖励方向一致。（收益有限，排在前两项之后。）

## 一句话总结

现有 orchestrator 已经是一个实现良好的「成本递增漏斗」：免费文本先筛、便宜预排序定
顺序、一次点击读简历做确定性硬门、最后才用 LLM rubric 评分并在有额度时打招呼，全程
状态闸护栏。收尾要做的是：**统一阈值（单一来源）、统一失败方向（fail-closed）、
让预排序对齐 rubric 权重**。
