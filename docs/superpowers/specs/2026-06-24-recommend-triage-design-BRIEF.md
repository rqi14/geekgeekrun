# 推荐牛人 · 选人 Sequence + 卡片级 LLM Triage —— 评审 Brief

> 目的：把已实现的漏斗 + 正在设计的 triage 完整摊开，请独立评审（Opus / Codex）**对抗性挑刺**：
> 实操中会出什么问题？哪些边界/失败模式/风控/配额/成本/LLM 行为我们没想到？
> 代码在 `packages/boss-auto-browse-and-chat/`（plain ESM .mjs，无 TS），UI 在 `packages/ui/`。

## 1. 系统与目标

BOSS 直聘**招聘端**自动化（Electron + Puppeteer）。「推荐牛人」页：BOSS 推一批候选人卡片，我们要**自动筛选 + 给最合适的人打招呼**。质量优先于数量——打错招呼/标错"不合适"都是**不可逆**且**烧稀缺配额**的。

## 2. 硬约束（这些是设计的根本）

- **两个每日硬配额，账号级共享（不是 per-run）**：
  - 主动查看（开简历看在线简历）：免费 20 / VIP 120（甚至更多）/天
  - 沟通（打招呼）：免费 3 / VIP 60/天
  - 用完会弹 VIP 购买拦截弹窗（`business-block-dialog`）。
- **不可逆动作**：打招呼、点"不合适"(X，且会训练 BOSS 推荐器)。
- **反爬/风控**：连续快速滚到底会触发风控；需拟人滚动（小步+停顿+偶尔回滚）。出现验证码/封号要停。所有点击走 ghost-cursor + 随机延时。
- **在线简历是 canvas 加密**：开简历后，简历画在**嵌套 iframe 内的 `#resume` canvas**（WASM 解密绘制，无明文 DOM）。只能靠 fillText 钩子抓（`setupCanvasTextHook` via `page.evaluateOnNewDocument`，跨 frame postMessage 到主页面汇总）。小卡片（列表项）只有：结构化学校/专业/公司/职位 + 自写"优势"——薄、且自写部分注水。
- **列表分页**：滚到底加载更多（无限滚动）。**不虚拟化**——滚走的卡仍在 DOM，可 `frame.$('div.card-inner[data-geek=ID]')` 定位，`scrollIntoView` 即可回到。
- **多岗位**：一天可能招多个岗位，轮流跑（daemon 队列）。账号配额要在岗位间分配。
- **LLM**：按 purpose 路由模型（`chatCompleteForPurpose`，`config.purposes[purpose].modelIds` 三级回落）。thinking budget 按模型配。功能必须**不配 LLM 也能用**（退化规则-only）。

## 3. 已实现（评审不必重复建议这些，但可指出其缺陷）

3 相批选漏斗 `recommend/orchestrator.mjs`：
- **A 收集+排序**（免费）：拟人滚动 `scrapeCards` → `ruleFilterList`（确定性硬条件：学历/城市/薪资带/屏蔽名等，命中点 X）→ 去重攒池 → `cheapPrescore`（写死启发式：学历×10+名校标签+活跃，**不看 rubric**）排序。
- **B 开简历+打分**（烧查看）：`rankForOpen` 取前 view-budget → `scrollCardIntoView` → `openResume` → `clearCapturedText`→抓 canvas 全文 `captureResumeText` → `score`（`evaluateResumeByRubric`，完整 rubric）。
- **C 选最高分+打招呼**（烧沟通）：`selectForGreet`（去 hardReject、≥阈值、按分降序、截 greet-budget）→ 卡上 `greetFromCard`（不重开简历）。
- 贯穿：起跑 `readQuota` 读真实剩余 seed 预算；`guard()` 每动作前 `detectState` + **URL 守卫**（离开 `/web/chat/recommend` 就导航回）；`business-block` 弹窗=硬兜底（对应预算清零、关弹窗、停）；验证码走 `checkpointRiskControl`。
- Layer-0：`applyNativeFilter`（另一 agent 做的"操作基座"，服务端原生筛选面板，A 相前设一次，gated on enabled）。
- 调试工具（零额度测试）：`read-quota`、`capture-resume`（开1份验 canvas）、`dry-run-sequence`（跑完整 A/B 不打招呼，可勾"仅看已看过"=重看不扣配额，返回决策报告含 scoringMode/passedRule）。
- 测试：node:test 纯逻辑 171 个全绿（state-classifier/quota-parse/selection/prescore/rule-filter 等）。

**已知待修（评审可确认/补充）**：
- `cheapPrescore` 不看 rubric → 查看额度可能花在会被 rubric 否决的人身上。
- `selectForGreet` 同分无原则 tie-break（保持原序）。
- 打招呼门用 `cfg.minScoreToChat`（默认0），**忽略了 rubric 自带的 `passThreshold`**（例：rubric 写 60，但实际 ≥0 就打招呼）。
- 多岗位配额：`budgets.greet = 真实剩余 ?? maxGreetPerRun` —— 读到真实剩余就**忽略 per-job 上限**，第一个岗位可能吃光全天配额。

## 4. 正在设计的 Triage（尚未实现，重点评审对象）

**动机**：列表人多（≫能开的≫能打招呼的），"开哪几个"现在靠 rubric-盲的 `cheapPrescore`。改成**开简历前先用便宜 LLM 读小卡片、按 rubric 粗排**，把稀缺查看额度分配对。

**设计要点（请逐条挑刺）**：
1. **可选**：配了 LLM+rubric 才启用；否则退回 `cheapPrescore`。开关 `cfg.cardTriage.enabled`。
2. **有界池**：拟人滚动收集上限 `cfg.triage.poolMax`（可配；VIP 大额度时收多屏）。不收全列表（风控+成本）。BOSS 列表+操作基座已粗排，前几屏即最相关。
3. **分 batch**：池超单批上限（`cfg.triage.batchSize` 默认~20）就拆批。
4. **跨批比较 = 绝对分**：每批一次调用，对每张卡按 rubric 打**绝对分 0-100 + knockout 标记**（各批独立、不相对排序）；合并按绝对分排。同一把尺子 → 可跨批比。triage 是粗排（决定开谁），绝对分漂移可接受，最终靠 canvas 精评。
5. **压缩 rubric**：triage 不用完整 rubric（~2500 tokens 太贵），用**压缩版**（knockouts + 维度名/权重 + passThreshold，去掉长 criteria/`_scoring_note`），~400-600 tokens，省 token 让 batch 更大。
6. **双 rubric**：`rubric`（完整，精评用）+ 可选 `triageRubric`（压缩，卡片用）；默认从完整自动派生，可覆盖。
7. **双模型/thinking**：triage→purpose `card_triage`（便宜/快/低 thinking）；精评→`resume_screening`（强/高 thinking）。
8. **配额分配修复**：`budgets.X = min(per-job 上限, 真实剩余)`。
9. **tie-break**：同分优先"刚刚活跃"（更可能回复）。
10. **passThreshold**：打招呼门 = `rubric.passThreshold`。

**最终漏斗**：
```
操作基座预筛 → 拟人滚动收有界池 → triage(分batch,压缩rubric,card模型,绝对分+knockout) 合并排序
  → 开全局前N(min(per-job额度,真实剩余),烧查看) → canvas精评(完整rubric,screening模型)
  → 打招呼(同分优先刚刚活跃, 门=passThreshold, 烧沟通)
```

## 5. 附：实际在用的 rubric（体现复杂度——大量 knockout 例外 + 知识迁移逻辑）

岗位：实验室技术员/研究助理（微球制造 R&D）。passThreshold 60。4 维度（教育20/颗粒材料合成35/化学工程深度25/科研独立性20）。3 条 knockout（核心：纯分子生物学背景且无颗粒/材料/化学合成→否决，但有大量例外：蛋白自组装/纳米纤维、酶催化矿化、冻干微球、液滴微流控操作 均不否决）。含长 `_scoring_note`（两步评分法：直接匹配 + 知识迁移）。完整 JSON 见对话记录/可向用户索取。

## 6. 请评审回答

1. **实操边界/失败模式**：这套在真实账号上跑，哪些情况会坏？（如：池收集中途被风控、canvas 抓取不稳、绝对分校准漂移导致开错人、batch 间 LLM 评分尺度不一、配额竞态、岗位切换、列表很少人/全是已看过、rubric 自动压缩丢了关键例外…）
2. **triage 性价比**：绝对分 triage 真能比 `cheapPrescore` 显著提升"开对人"？还是 LLM 成本/延迟/不稳定不值？有没有更简单等效的做法？
3. **绝对分跨批**：用绝对分合并是否可靠？LLM 跨调用打分尺度漂移多严重？要不要锚点样本/校准？
4. **压缩 rubric 风险**：自动从完整 rubric 派生压缩版，会不会丢掉决定性的 knockout 例外（如"液滴微流控操作不否决"），导致 triage 误杀该开的人？
5. **配额/多岗位**：min(per-job, 真实剩余) 够不够？跨岗位/跨进程的配额竞态？
6. **遗漏**：我们整个对话没提到、但实操必然撞上的东西。

直说，挑毛病，不必客气。
