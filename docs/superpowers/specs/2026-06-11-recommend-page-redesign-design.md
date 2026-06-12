# 推荐牛人页自动化重构 — 设计文档 (v2)

- 日期：2026-06-11
- 范围：`packages/boss-auto-browse-and-chat` 的"推荐牛人"页(`/web/chat/recommend`)主动打招呼流程
- 状态：待用户批准。v2 已纳入 Codex + Opus 子代理评审(用户外出期间代评审)的全部 blocking 项。

> **v2 相对 v1 的关键变更**(评审驱动)：
> 1. **打招呼改为在简历弹窗内完成**(成功信号 `继续沟通` 是抓取已验证的)，删除"关简历→回列表点打招呼"的回环和未验证的"已向牛人发送招呼/知道了"弹窗依赖。
> 2. **波次按视口可达性挑卡**，不再按 DOM 顺序 `slice`；禁止 `scrollIntoView` 绕过滚动预算。
> 3. **卡片选择器收窄到主候选卡**，排除 `similar-geek-wrap`(相似推荐) / `quick-top` 等非主卡。
> 4. **风控分两类**：可恢复的安全验证(复用现有 `risk-detector.mjs` 等人工)与不可恢复的账号封禁(立即中止)。
> 5. **不感兴趣原因改为模糊匹配**(原因文案含 JD、动态生成，固定枚举会失配)。
> 6. 统一用 `encryptGeekId`(与现有代码/实体一致)。
> 7. v1 砍掉：简历内"不合适"、WASM canvas 抽取、弹窗翻页遍历(移到 §10)。

---

## 1. 背景与目标

现有推荐页逻辑三个根本问题(用户原话)：会去点视口外的候选人；无法可靠响应卡片点击效果(以为点了其实没点中、弹窗不处理、**不知道当前在什么状态**)；靠激进滚动加载样本，已触发账号风控被封(见 `memory/recommend-scroll-ban.md`，2026-06-09 滚到底被封)。

**重新定位(关键)**：每日打招呼与 X 额度有限。目标不是"处理完所有人"，而是 **把有限的打招呼花在见过的人里最好的几个**；X 是策略性动作——给平台"定向优化"信号。

### 目标

- **G1 安全**：永不无界滚动；滚动是有硬上限的采样预算。检测到**账号封禁**立即中止；检测到**安全验证**暂停等人工。
- **G2 状态感知**：每个动作前后先检测页面状态，按状态决策，动作后验证生效，不盲点。
- **G3 择优**：列表文字规则初筛 → 开在线简历精筛 + LLM 评分 → 在简历弹窗内对达标者打招呼，优先处理预估更优者，受额度约束。
- **G4 只操作可达元素**：只对当前在视口内、可交互的卡片/按钮动作。

### 非目标(YAGNI)

- 不做"邀约"独立动作(列表/简历的"打招呼"就是唯一触达，无单独邀约 UI)。
- 不做"刷到没有更多"终点检测(列表无限累积、不虚拟化：实测 237 张、scrollTop ~40000px 仍在加载，无自然终点；唯一终点是自设预算)。
- v1 不抽取 WASM canvas 全文简历(用简历弹窗"经历概览"文本 + 列表文字评分)。
- v1 不在简历弹窗内点"不合适"——所有 X 统一从列表执行。

---

## 2. 地面真相(抓取确认)

来源 `dev/snapshots/`。所有候选人内容在 `iframe[name="recommendFrame"]` 内。

### 2.1 主候选卡(注意：`li.card-item` 被复用)

`ul.card-list > li.card-item` **不全是主候选卡**：`010-list/iframe.html` 第 25 行的某个 `li.card-item` 内含 `div.similar-geek-wrap`(相似推荐块)，其内部也有 `data-geek` 和打招呼按钮。**必须收窄**：

- 主候选卡 = `li.card-item` 内**直接**的 `div.candidate-card-wrap > div.card-inner[data-geek]`，且该 `li` 内**不含** `.similar-geek-wrap`；跳过 `quick-top`/促销块。
- 每张卡须校验：非空 `data-geek`、存在 `.operate-side button.btn-greet`、存在 `div.tooltip-wrap.suitable`。无 ID 的卡直接丢弃。

主候选卡内可读字段(纯文字)：

```
div.card-inner[data-geek]                       ← encryptGeekId
  .col-1 .salary-wrap span                       ← 薪资 "10-11K"
  .col-2 .name-wrap span.name / span.active-text ← 姓名 / "刚刚活跃"
         .base-info span                          ← 年龄 / 应届或经验 / 学历
         .expect-wrap .content                    ← 期望城市 + 行业
         .geek-desc .content                      ← 优势自述
         .tags-wrap .tag-item                      ← 标签
  .edu-exps .timeline-item / .work-exps .timeline-item  ← 教育/工作经历全文
div.tooltip-wrap.suitable > i.icon.iboss-close   ← X(不感兴趣)
.operate-side button.btn-greet                    ← 列表打招呼(v1 不用，见 §4 决定在简历内打)
```

### 2.2 状态与转移

`detectState(page, frame)` 同时检查主页面与 `recommendFrame`：

| 状态 | 判定 | 处理 |
|------|------|------|
| `ACCOUNT_BANNED` | 主页面文案 `/账号.*不可使用\|不可使用状态\|登录BOSS直聘手机APP查看详情/` | **立即 throw 中止全运行** + 截图 + 通知(账号安全第一) |
| `VERIFY` | 复用 `risk-detector.mjs` `detectRiskControl(page)`(URL/验证元素/滑块文案) | **暂停**，`waitForRiskControlCompletion` 等人工完成后继续(可恢复) |
| `RESUME_MODAL` | frame 内 `div.dialog-wrap.active .dialog-lib-resume` | 评分/打招呼/关闭 |
| `LIST_REASON_PANEL` | frame 内 `div.card-reason-f1.show` | 一键 `span.first-reason-item`(模糊匹配)，或 `div.close-icon` 关 |
| `RESUME_REJECT_DIALOG` | 主页面 `div.dialog-wrap.active .feedback-wrap`(`.dialog-default-v2`) | v1 不主动触发；若误现则关闭(`.boss-popup__close`) |
| `GOVERNANCE_NOTICE` | 主页面 `.dialog-uninstall-extension` | `dismissGovernanceNoticeDialog`(每次登录必现) |
| `QUOTA_BLOCKED` | 文案 `/今日.*(招呼\|沟通).*上限\|已达上限/` | 停止该类动作 |
| `LIST` | 主页面与 frame **均无**阻塞性弹窗，且 frame 有 `ul.card-list` | 正常波次处理 |
| `UNKNOWN` | 都不匹配 | 截图存证 + 安全退出本次运行 |

> 风控字符串(`ACCOUNT_BANNED` / `QUOTA_BLOCKED`)目前为宽匹配兜底，真机需再核对精确文案；先用 DOM fixture 单测覆盖。`VERIFY` 与 `ACCOUNT_BANNED` 是两个不同信号：前者可恢复(等人工)，后者不可恢复(中止)，不可合并。

### 2.3 简历弹窗(`RESUME_MODAL`)— v1 在此打招呼

```
frame: div.dialog-wrap.active .dialog-lib-resume.recommendV2
  .resume-detail-wrap iframe[src="/web/frame/c-resume/?source=recommend"]  ← WASM 全文(v1 不用)
  .resume-right-side .resume-summary  h4"经历概览" + ul.jobs.education li   ← v1 评分文本
  .button-chat-wrap.resumeGreet button.btn-v2.btn-sure-v2.btn-greet "打招呼"
       └─ 打招呼成功后原地变 → div.btn-continue-wrap > button.btn-outline-v2 "继续沟通"  ← 唯一已验证的成功信号
  .btn-quxiao "不合适"   ← v1 不用
  .turn-btn.prev / .turn-btn.next  ← v1 不用(§10)
  .close-btn             ← 关闭(在 frame 内的弹窗上，**非**主页面 .boss-popup__close)
```

> **简历弹窗在 iframe 内**：关闭须在 `frame` 上点 `.close-btn`(现有 `RESUME_POPUP_CLOSE_SELECTOR='div.boss-popup__close'` 查的是主页面、对此弹窗是空操作，须改)。打开后须**校验弹窗身份**(弹窗有 prev/next，可能残留上一个人)：打招呼前确认弹窗对应刚点击的 `encryptGeekId`(用 `.resume-summary` 或可得的 id 比对)，不符则关掉重开。

### 2.4 两种"不感兴趣/不合适"原因 UI(都给平台优化信号；原因动态生成)

- **列表 X**(`div.tooltip-wrap.suitable > i.iboss-close`，frame 内)→ frame 内 `div.card-reason-f1.show`，选项 `span.first-reason-item`(一键)。
- **简历"不合适"**(`.btn-quxiao`)→ 主页面 `.feedback-wrap` 勾选框 + 提交(v1 不用)。

原因文案**随候选人与 JD 动态生成**(如 `不考虑硕士` vs `不考虑本科`；`期望（药物分析）与职位不符` 内嵌 JD)。→ **必须模糊匹配**，不能用固定枚举：

| 内部 reason | 匹配规则(选项文案 contains) | 兜底 |
|---|---|---|
| city | `距离远` | 其他原因 |
| education | `不考虑`(学历类) | 其他原因 |
| workExp / skills | `与职位不符` 或 `工作经历` | 其他原因 |
| viewed | `重复推荐` | 其他原因 |
| 其它 | — | `其他原因` |

(推广现有 `NOT_INTERESTED_REASON_POSITION_MISMATCH='与职位不符'` 的思路，弃用固定 `NOT_INTERESTED_REASON_MAP` 精确匹配。)

### 2.5 行为事实

- 列表无限累积、不虚拟化、无终点 → 滚动必须硬上限。
- X + 选原因后卡片消失、列表上移、count 减 1 → "删一个补一个"天然把新卡带进视口，是反激进滚动的核心。

---

## 3. 架构

`packages/boss-auto-browse-and-chat/recommend/` 下小而单一职责模块，取代纠缠的 `index.mjs` 主循环 + `candidate-processor.mjs`(scrollAndLoadMore) + `chat-handler.mjs`：

```
recommend/
  orchestrator.mjs      波次主循环 + 预算 + 停止条件 + 状态守卫 + 触发现有 hooks
  page-state.mjs        detectState(page, frame)；waitForState；自愈(关残留弹窗/治理公告)
  list-scraper.mjs      scrapeCards(frame) → 主候选卡结构化(收窄选择器，§2.1)
  rule-filter.mjs       列表文字硬规则初筛(下沉并复用现有 filterCandidates 系列)
  resume-inspector.mjs  openResume / assertIdentity / readSummary / greetInModal / close(在 frame 上)
  scorer.mjs            score(candidate, resumeData, jd, cfg) → {score, reason}(规则门 + LLM)
  actions.mjs           rejectFromList(+模糊原因) / scrollGently；ghost-cursor + 随机延迟；
                        **禁止 scrollIntoView 绕过滚动预算**(只能在 scrollGently 内滚)
```

复用：`candidate-processor.mjs` 的 `parseSalaryRange / parseWorkExpYears / filterCandidates` 下沉到 `rule-filter.mjs`；`risk-detector.mjs`(`detectRiskControl` / `waitForRiskControlCompletion`)用于 `VERIFY`；`humanMouse.mjs`(ghost-cursor)、`@geekgeekrun/utils`(sleep / GPT)；`dismissGovernanceNoticeDialog`、登录与 hooks 构造保留。

`constant.mjs` 需**新增/修正**：简历弹窗 `.dialog-lib-resume / .button-chat-wrap.resumeGreet button.btn-greet / .btn-continue-wrap / .close-btn`、`.card-reason-f1.show`+`.first-reason-item`、风控/额度/封禁文案、收窄后的主卡选择器。修正 `RESUME_POPUP_CLOSE_SELECTOR`(改为 frame 内 `.close-btn`)。

---

## 4. 波次循环(orchestrator)

一"波" = **视口内可达**的一批未处理主候选卡。顺序：检测 → 选视口卡 → 初筛 → 精筛(开简历、达标即在弹窗内打招呼) → X 明显不匹配(改动列表，放最后) → 必要时小幅滚。统一用 `encryptGeekId`。

```
budgets = { greet: cfg.maxGreetPerRun, x: cfg.maxXPerRun, scroll: cfg.maxScrollSteps }
seen = Set<encryptGeekId>()    // 本次运行已处理(含中庸者)，避免重复开简历/重复打分
staleWaves = 0                  // 连续无新卡计数，防空转

loop:
  st = detectState()
  if st == ACCOUNT_BANNED: throw  // 中止全运行(G1)
  if st == VERIFY: waitForRiskControlCompletion(); continue
  if st in {RESUME_MODAL, *_PANEL, *_DIALOG, GOVERNANCE_NOTICE}: selfHeal→关闭回 LIST

  cards = scrapeCards(frame)                    // 仅主候选卡，含 rect/inViewport
            .filter(c => c.encryptGeekId && !seen.has(c.encryptGeekId))
  wave = cards.filter(c => c.interactableInViewport)   // G4：只取视口内可点的
  if wave.isEmpty:
     if budgets.greet<=0 or budgets.scroll<=0 or staleWaves>=cfg.maxStaleWaves: break
     scrollGently(); budgets.scroll--; continue          // G1：唯一允许滚动处

  // 预排序：用列表文字便宜地估个序，优先处理更可能优的(近似"看最好的")
  wave = wave.sortByCheapPrescore(desc).slice(0, cfg.waveSize)

  newCount = 0
  for c in wave:
     // 阶段 A：列表硬规则初筛
     pre = ruleFilterList(c, cfg.rules)                  // 'pass' | {reject, reason}
     if pre.reject:
        if budgets.x>0:
           rejectFromList(c, fuzzyReason(pre.reason)); waitForCardRemoved(c.encryptGeekId); budgets.x--
        seen.add(c.encryptGeekId); newCount++; continue

     // 阶段 B：精筛 —— 开在线简历评分
     if !openResume(c): seen.add(c.encryptGeekId); continue      // 打不开→跳过，不盲点
     if !assertResumeIdentity(c): closeResume(); continue         // 弹窗非此人→关掉重来
     resume = readSummary(modalFrame)
     scored = score(c, resume, cfg)                               // 规则门(硬不达标→reject) + LLM

     // 阶段 C：达标即在弹窗内打招呼(成功信号=继续沟通)
     if scored.hardReject and budgets.x>0:
        closeResume(); rejectFromList(c, fuzzyReason(scored.reason)); waitForCardRemoved(c.encryptGeekId); budgets.x--
     elif scored.score >= cfg.minScoreToChat and budgets.greet>0:
        greetInModal(modalFrame)                                  // 点 btn-greet
        if confirmGreetSucceeded(modalFrame):                     // 等 .btn-continue-wrap/继续沟通
           budgets.greet--; fireHook('afterChatStarted', c, ok)
        closeResume()
     else:
        closeResume()                                             // 中庸者：不打不 X，留给平台
     seen.add(c.encryptGeekId); newCount++
     sleepRandom(cfg.delayBetweenActionsMs)
     if budgets.greet<=0 and budgets.x<=0: break

  staleWaves = (newCount==0) ? staleWaves+1 : 0
  if budgets.greet<=0 and budgets.x<=0: break
```

**三类归宿**：明显不匹配(初筛硬拒 / 简历硬规则拒) → X；中庸(过规则但分 < 阈值) → 不打不 X、标记 seen；达标(分 ≥ 阈值) → 弹窗内打招呼，额度内、预排序优先。
**停止**：打招呼与 X 额度均满 / 无视口新卡且滚动额度满 / 连续 `maxStaleWaves` 波无新卡 / `ACCOUNT_BANNED`。

---

## 5. 评分(scorer.mjs)

1. **规则门**(复用 `filterCandidates` 思路，作用在简历+列表合并数据)：硬不达标 → reject(进入 X)，不调 LLM。
2. **LLM 精排**：JD + 候选人结构化文字(列表字段 + 简历"经历概览")→ `{score:0-100, reason}`。复用 `@geekgeekrun/utils` GPT 调用。
3. **失败兜底**：`onScoreError: 'skip' | 'greetIfRulePass'`(默认 `skip`，不浪费额度不误伤)；LLM 限流时退避重试有限次。

---

## 6. 配置(`~/.geekgeekrun/config/boss-recruiter.json`)

```jsonc
"recommendPage": {
  "waveSize": 6,
  "maxGreetPerRun": 20,          // 配置上限(双保险之一)
  "maxXPerRun": 10,              // X 保守：策略信号 + 限额，宁少勿多
  "maxScrollSteps": 6,           // 硬上限 —— 反封号安全闸(G1)
  "maxStaleWaves": 2,            // 连续无新卡上限，防空转
  "scrollDelayMsRange": [800, 2000],
  "delayBetweenActionsMs": [1500, 4000]
},
"scoring": {
  "enabled": true,
  "minScoreToChat": 60,
  "onScoreError": "skip",
  "jd": "<职位描述文本>",
  "llm": { "model": "...", "promptTemplate": "..." }
}
```

规则初筛复用现有 `candidate-filter.json`。页面额度检测(`QUOTA_BLOCKED`)与配置上限构成"双保险"。`maxXPerRun` 默认保守(评审 N7：X 是限额负信号，不宜每个过滤者都 X)。

---

## 7. 错误处理与自愈

- **状态守卫**：每轮开头 `detectState`；残留弹窗(简历/原因/拒绝/治理公告)先自愈关闭回 `LIST`。
- **动作验证**：打招呼后必须观察到 `继续沟通`，否则不计额度、记 warn、不盲点重试；X 后必须观察卡片消失。
- **ACCOUNT_BANNED**：任意时刻检测到 → 立即 throw 中止全运行 + 截图 + 通知。
- **VERIFY**：复用 `risk-detector` 暂停等人工(可恢复)，**不**与封禁混用。
- **简历打不开 / 弹窗身份不符**：跳过该人或关掉重来，不盲点。
- **evaluate 抛错(frame 导航中)**：catch 后下一轮重试，不崩。
- **UNKNOWN**：截图存证后安全退出本次运行。

---

## 8. 测试策略(TDD)

- **纯函数单测**：`rule-filter`(各 reason 分支)、`scorer` 规则门、`fuzzyReason`(动态文案 contains 匹配)、salary/workExp 解析、`cheapPrescore` 排序。用 `dev/snapshots/` 真实卡片文本做 fixture。
- **page-state 单测**：用抓取的 `iframe.html / main-overlays.html` 片段做 DOM fixture，断言 `detectState` 返回正确枚举(尤其 `ACCOUNT_BANNED` vs `VERIFY` vs `RESUME_REJECT_DIALOG`，及主卡 vs `similar-geek-wrap` 过滤)。
- **选择器存在性脚本**：对照 `dev/snapshots/` 校验 `constant.mjs` 关键选择器。
- 端到端：人工跑一轮 `maxGreetPerRun=2 / maxXPerRun=2` 小额度观察。
- 先写 `rule-filter` / `page-state` / `list-scraper`(主卡过滤)失败测试，再实现。

---

## 9. 迁移、Hooks 与影响

- `index.mjs` 推荐页主循环替换为 `orchestrator.run(hooks)`；登录 / `dismissGovernanceNoticeDialog` / hooks 构造保留。
- **Hooks 必须保活**：orchestrator 须按现有签名触发 `onCandidateListLoaded` / `onCandidateFiltered`(waterfall: candidates, filterResult) / `beforeStartChat(candidate)` / `afterChatStarted(candidate, result)` / `onError(error)` / `onComplete`(见 `run-core-of-boss-auto-browse/main.mjs:48-58`)，参数形状与 `SqlitePlugin.apply` 期望一致，确保 sqlite/webhook 落库不回归。实现阶段须核对 SqlitePlugin 监听的 hook 与 payload。
- `candidate-processor.mjs` 的 `scrollAndLoadMore`(激进滚动)弃用，并入 `actions.scrollGently`(有上限)。`filterCandidates` 系列下沉 `rule-filter.mjs`。
- `chat-handler.mjs` 的 `viewCandidateDetail` / 旧关闭选择器作废，由 `resume-inspector` 取代。
- `run-core-of-boss-auto-browse` 守护入口不变(同名导出或 thin wrapper)。

---

## 10. 待办/未来

- 简历弹窗内"不合适"(`.btn-quxiao` → `.feedback-wrap` 勾选 + 提交)路径。
- 列表打招呼路径 + 其成功信号(需先真机抓"已向牛人发送招呼/知道了"弹窗，现有快照该状态为空、未验证)。
- WASM canvas 全文简历抽取(`resume-extractor.mjs`)接入 scorer。
- 简历弹窗 `turn-btn.next` 顺序遍历模式(完全不碰列表滚动)。
- `seen` 跨运行复用(从 `_hasViewed` / sqlite `CandidateContactLog` 预填，省重复评分成本)。
- 真机核对 `ACCOUNT_BANNED` / `QUOTA_BLOCKED` 精确文案。
