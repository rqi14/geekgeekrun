# 推荐牛人 — BOSS 原生「筛选」面板能力层（Layer-1 服务端漏斗）

日期：2026-06-24
分支：`feat/recommend-native-filter`（基于 `feat/recommend-page-redesign` / PR #10）

## 背景与动机

PR #10 的推荐主循环目前所有筛选都在**客户端**：抓全部卡片 → `rule-filter`/`prescore` 初筛 → 开在线简历 → LLM 精排 → 打招呼/X。BOSS 推荐页顶部还有一个**服务端**「筛选」面板（`#headerWrap … .recommend-filter.op-filter`），点开后能按 学历/经验/意向/薪资（免费）以及 院校档次/专业大类/活跃度/性别/跳槽频率/年龄（VIP「高级筛选」特权）改变**列表里出现哪些候选人**。当前自动化完全没用它。

为什么值得做（且优先级不低）：

- **配额极小且硬性**：每日「主动查看」免费 20 / VIP 120，每日「沟通」免费 3 / VIP 60，在线竞招职位 0 / 3。每一次开简历、每一次打招呼都是稀缺资源。服务端预筛把推荐池在**源头**收窄，意味着花在「查看」配额上的少数候选人本身就已经更相关 —— 预算越小，预筛越高杠杆。
- **触达 VIP 维度**：院校档次/专业大类/活跃度等只有原生面板能做，客户端拿不到。
- **与现有客户端筛选互补**：原生面板只有粗档（院校只有 985/211/双一流/留学/名校/公办本科；专业只有大类），**精确**到具体学校名/专业关键词/技能/LLM 仍由现有客户端 Layer-2 负责。两层是不同粒度，不是重复。

## 范围边界（重要）

本 spec 只交付一个**通用、无状态、无意见的能力层（底座）**：

- 一个纯函数 planner + 静态 catalog
- 一个 impure driver：`applyNativeFilter(page, frame, cursor, plan)` —— 打开面板、按计划点选项、点确定、等列表稳定，返回带 `ok/reason` 的「实际生效/被跳过」报告
- `constant.mjs` 选择器
- `candidate-filter.json` 的 `nativeFilter` 配置 schema + per-job 透传
- 两个一次性调试命令（`apply-native-filter` / `diagnose-filter`）用于单步真账号验证

**明确不在本 spec 内（由后续另一个 agent 决定）：**

- **何时调用、调用几次、在主循环哪个位置调用、是否每个职位重设** —— 一律不在这里决定。`applyNativeFilter` 是一个可在任意时机调用的原语，不内嵌任何循环/预算/时序逻辑。
- orchestrator 的接线改动（`orchestrator.mjs` 里加调用点）—— 留给后续集成。本 spec 交付的代码**不修改主循环控制流**。

只交付「能用的底座」，怎么操作之后再说。

## YAGNI（v1 不做）

- 年龄滑块（`vue-slider`，交互方式不同，不是点选项）
- 专业「修改筛选专业」自定义子集（只支持面板里直接列出的大类）
- 从 `candidate-filter` 现有 `expect*` 键自动推断 `nativeFilter`（approach C，后续可加）

## 配置 schema

在 `candidate-filter.json` 里新增可选块 `nativeFilter`（与现有 `expect*` 键同级，复用同一套 `getMergedJobConfig` / `jobFilterToCandidateFilter` 读取与透传路径）：

```jsonc
"nativeFilter": {
  "enabled": true,
  "degree":      ["本科", "硕士"],   // 免费, 多选
  "experience":  ["3-5年"],          // 免费, 多选
  "intention":   [],                 // 免费, 多选
  "salary":      "10-20K",           // 免费, 单选 (string|null)
  "activation":  "今日活跃",          // VIP,  单选 (string|null)
  "school":      ["双一流", "985"],   // VIP,  多选（档次，非校名）
  "major":       [],                 // VIP,  多选（大类）
  "gender":      [],                 // VIP,  多选
  "switchJobFrequency": null          // VIP,  单选 (string|null)
}
```

- 单选维度（`salary`/`activation`/`switchJobFrequency`）取 `string | null`；多选维度取 `string[]`。
- `enabled:false` 或整块缺省 → planner 产出空计划，driver 等价 no-op。
- 所有取值必须是 BOSS 面板里的**精确文案**（面板按文本匹配）。catalog 是合法值的唯一真相来源。

### 配置来源：全局 vs per-job（Opus review 必改点）

两条路读取方式不同，**driver 与纯层无关，但交付的透传补丁必须两条都覆盖**：

- **全局/单跑路径**：`getMergedJobConfig(jobId=空)` 把 `candidate-filter.json` **原样** 作为 `candidateFilter` 透传（`runtime-file-utils.mjs:244-247`）。`nativeFilter` 在这条路上**已经能原样存活**，无需改代码。
- **per-job 路径**：`getMergedJobConfig(jobId)` 读 `boss-jobs-config.json` 里该职位的 `jobs[].filter`，经 `jobFilterToCandidateFilter()` 转换（`runtime-file-utils.mjs:165-203`）。该函数返回**写死的对象字面量**，不 spread 输入 —— 任何未显式列出的键被**静默丢弃**。所以 per-job 的 `nativeFilter` 必须：
  1. **作者位置**：写在 `boss-jobs-config.json` 的 `jobs[].filter.nativeFilter`（与 `expectSchoolKeywords` 等同级，shape 与上面的 `candidate-filter.json` 示例一致）。
  2. **透传补丁**：在 `jobFilterToCandidateFilter()` 的返回对象里**加一行** `nativeFilter: f.nativeFilter && typeof f.nativeFilter === 'object' ? f.nativeFilter : undefined`（沿用现有键的防御式写法）。不加则 per-job 原生筛选被吞掉。
  3. **UI（可选，非本 spec）**：若要在界面按职位填，职位配置 UI 需加该字段；本 spec 只保证配置能流通，不做 UI。

## 组件设计

### 1. 纯 planner + catalog — `recommend/pure/native-filter.mjs`（+ `.test.mjs`，TDD）

- `NATIVE_FILTER_CATALOG`：每个维度 → `{ groupClass, vip:boolean, single:boolean, options: string[] }`。
  - 免费：`degree`(多)、`experience`(多)、`intention`(多)、`salary`(单)
  - VIP：`activation`(单)、`school`(多)、`major`(多)、`gender`(多)、`switchJobFrequency`(单)
  - `options` 为面板精确文案数组（如 degree：`['初中及以下','中专/中技','高中','大专','本科','硕士','博士']`）。
- `normalizeOption(s)`（**Opus review 必改点**）：纯层导出**唯一**的文案归一函数，driver 必须 import 复用。BOSS 面板 DOM 的选项文本带前后空白与换行（实测样本 `"\n    本科\n"`）。定一套规则：`String(s ?? '').replace(/\s+/g, '')`（去掉全部空白，含中间换行）。**纯层校验「配置值 ↔ catalog」与 driver 读 DOM `.option` 文本必须用同一个 `normalizeOption`**，否则合法选项会被一边 trim、另一边精确匹配而静默落进 `skipped`。
- `planNativeFilter(nativeFilterCfg, catalog = NATIVE_FILTER_CATALOG)` → `{ apply: [{ group, single, options: string[] }], skipped: [{ group, value, reason }] }`
  - 纯函数、**VIP 无关**：把配置取值经 `normalizeOption` 归一后对着 catalog 校验。`apply[].options` **统一存原始 catalog 文案**（单一约定，不存归一值）；driver 在**比对时**对两边各 `normalizeOption` 一次。下文 driver 步骤里的"归一后目标文案"即指此运行期比对，不改变 plan 的存储约定。
  - 不合法文案 → 进 `skipped`（`reason:'unknown-option'`），不抛错。
  - 空值/`enabled:false` → 该维度不进 `apply`。
  - 单选维度给了数组只取第一个；多选维度给了字符串当单元素数组。
  - VIP 门禁**不在纯层判断**（运行期才知道有没有 VIP），由 driver 决定，保证纯层确定可测。
  - **catalog 作为参数注入**（默认指向生产常量），使单测能传 fixture catalog，不依赖真值。

### 2. driver（impure）— `recommend/native-filter-driver.mjs`

仿 `actions.mjs` / `resume-inspector.mjs` 风格（ghost-cursor、`sleepWithRandomDelay`、`cursor.click(handle).catch(() => handle.click())` 回退）。

**签名（Opus review 必改点）**：`applyNativeFilter(page, frame, cursor, plan)` —— 与本模块所有现成 impure 函数（`openResume(page, frame, cursor, …)` / `rejectFromList(page, frame, cursor, …)`）一致,**不是单个 `target`**。面板触发器在主页面 `page` 上开；列表稳定要在 `frame` 上确认（见下「frame vs page」）。单一 `target` 无法同时满足"主页面开面板"和"iframe 确认列表"。

步骤：

1. 点面板触发器打开 `.filter-panel`，等面板可见。**若超时/面板没出现 → 直接返回失败结果（见报告形状），不继续。**
2. **折叠区幂等展开**：仅当 `plan.apply` 含 VIP 维度时处理；先**读当前展开/折叠状态**（`vip-filters-wrap` 是否带 `show-folded` / `vip-folded` 是否可见），**只有在折叠时才点** `vip-folded`。绝不无条件点（会把已展开的面板又收起来）。
3. **运行期 VIP 门禁**：检测 `.vip-mask`（或 VIP 组不可点）。VIP 不可用 → VIP 维度整体跳过并记入 `skipped`（`reason:'vip-locked'`）。这是「有时有 VIP」的降级路径。
4. **清空再选（幂等）**：对每个要应用的维度，先点该组的「不限」复位项（`.default.option`）清掉历史选择，再开始勾。保证「按 plan 操作一次」与面板已有状态/调用顺序无关（尤其单选维度避免旧值残留）。
5. 对每个维度：定位 `.check-box.<groupClass>` → 遍历组内 `.option`（注意 `major` 等组的 `.option` 可能**嵌在 `.popover.filter-tooltip` 包裹里**，用后代选择器匹配，不假设是直接子节点），`normalizeOption(el.innerText)` 与目标 `normalizeOption(catalog文案)` 相等则点（单选点一个；多选逐个点）。
6. **整组回读验证（report 诚实性，Codex 查漏修正）**：**不做"每点一次记一次"**，而是该组全部点完后**回读整组当前选中态**（带 `active` class 的 `.option` 集合），令该组 `applied = 目标 ∩ 实际选中`，目标里没出现在实际选中的进 `skipped`（`reason:'click-no-effect'`）。这样**天然兼容单选组自动反选**（避免把"点过但被后一次顶掉"的项误记成 applied），也覆盖 VIP present-but-inert。报告反映「实际观测到的选中态」，不是「点了几下」。
   > 各维度单选/多选以 catalog 的 `single` 为准（`[单选]`：活跃度/跳槽频率/薪资）；**但 `single` 实际值必须用 `diagnose-filter` 对真站点逐组核对后再定稿**——若某看似多选的组（如经验）实为单选,整组回读法不会误报，但 catalog 的 `single` 仍应改对以便清空逻辑正确。
7. 点 **确定**：**按文案 `确定` 正向定位**（与选项同一套精确匹配），class 排除（非 `.default`/`.btn-outline`）仅作回退。避免站点新增按钮时"排除法"点错。
8. 等列表在 **`frame`** 上稳定。**确定后列表可能为两种合法终态**（Codex 查漏新增）：(a) `LIST`（`ul.card-list` 存在）；(b) **筛选后零结果的空态屏**（不同于 `LIST`，`page-state` 不会返回 `LIST`）。driver 须 `Promise.race`/轮询**等"LIST 或 空态选择器"任一出现**，带自身有界超时；命中空态则报告标记（如 `listEmptyAfterApply:true`），**绝不死等 `LIST` 而挂起**。空态选择器在实现时用 `diagnose-filter` 核对。
9. 返回报告（见下）。

**报告形状（Opus review 必改点）**：
```js
{
  ok: true | false,                 // 面板是否成功打开并走完流程
  reason: undefined | 'panel-not-opened' | 'no-frame' | 'driver-error',
  applied: [{ group, options: [...] }],   // 整组回读后观测确实选中的
  skipped: [{ group, value, reason }],     // 'unknown-option' | 'vip-locked' | 'click-no-effect'
  listEmptyAfterApply: false | true        // 确定后命中零结果空态屏（非错误，是合法终态）
}
```
- `ok:false + applied:[]`（面板没开/无 frame/崩）与 `ok:true + applied:[]`（plan 本就为空）**必须可区分** —— 否则"啥也没做"和"坏了"长得一样，违背可观测初衷。
- `skipped` 的 `reason` 只有三种;**纯层"空值/`enabled:false` 不进 `apply`"的维度根本不出现在报告里**（不是 `skipped`），与 planner 约定一致(不存在 `'empty'` reason)。

健壮性：整个 driver 包 try/catch；任何抛错 → 返回 `{ ok:false, reason:'driver-error', applied:[], skipped:[...] }`，**绝不让整轮崩**（与 PR「无效正则不让整轮崩」一致）。driver 不读配置、不碰预算、不决定调用时机 —— 纯粹「按给定 plan 操作面板一次」。

### 3. 选择器 — `constant.mjs`

新增（具体值在实现时对真实站点核对）：

- 面板触发器：`#headerWrap … .recommend-filter.op-filter` 内的触发 `div`
- 面板：`.filter-panel`
- VIP 折叠展开：`.vip-filters-wrap .vip-folded`
- VIP 锁标识：`.vip-filters-wrap .vip-mask`
- 维度组：`.check-box.<degree|experience|intention|salary|activation|school|major|gender|switchJobFrequency>`，组内选项 `.option`（`.default.option` 是「不限」复位项）；选中态判定 class（实测核对，疑似 `active`）
- 确定/清除：**优先按钮文案** `确定` / `清除` 正向匹配；class（确定 `.btns .btn` 非 `.default`；清除 `.btn.btn-outline.default`）仅作回退

> **frame vs page（实现第一步必须先核对）**：`plan/recommend_page_flow.md §2` 确认候选人列表在 `iframe[name="recommendFrame"]`，而 `#headerWrap`（职位下拉，`constant.mjs:133`）在**主页面**。故筛选面板触发器极可能在主页面 `page` 上，但它筛的列表在 `frame` 里。driver 因此**同时需要 `page`（开面板）和 `frame`（确认列表 re-stabilize）**——印证上面的 `(page, frame, cursor, plan)` 签名。先用调试工具 dump 一次确认面板究竟在哪个 frame。

### 4. per-job 透传 — `runtime-file-utils.mjs`

`jobFilterToCandidateFilter`（`:165-203`）返回对象里加一行 `nativeFilter` 透传（防御式：非对象则 `undefined`），与现有 `expectSchoolKeywords` 等同样处理，使 per-job 配置也带上 `nativeFilter`。详见上「配置来源」节。**仅透传，不决定何时用。** 同步补一条 `__jobFilterToCandidateFilter` 单测（已有别名导出 `:206` 供 `job-filter-passthrough.test.mjs`）。

## 调试与测试工具（确认底座够用）

已盘点现有调试/测试设施，结论：**纯层完全够用，driver 的"观测"够用、"单步调用"差一个口子，需补一个一次性命令。**

现成可复用（无需改动）：
- **`bossRecommendDebugMain` worker**（`packages/ui/src/main/flow/BOSS_RECOMMEND_DEBUG_MAIN/index.ts`）：起一个**可见、已登录**、停在推荐页的浏览器，经 fd3/fd4 收 JSON 命令（`ping`/`snapshot`/`detect-state`/`scrape-cards`/`scroll`/`open-resume`/`greet`/`reject`/`diagnose-reject`…），**不跑主循环**。GUI 在「招聘端调试工具 → 推荐牛人页」标签。失败/异常自动 `snapshot`。
- **`dev/capture-recommend.mjs`**（`node dev/capture-recommend.mjs`）：独立 CLI，dump **清洗后的 iframe HTML + 浮层 HTML + 卡片几何 + meta.json**，状态变化自动抓拍。**开发选择器的主力**——手动点开 BOSS 原生筛选面板、敲个 label，即可把 `.filter-panel` 的 DOM 落盘，零改动。
- **`node:test` 纯单测**：`recommend/pure/*.test.mjs` 现成 10 个范例 + `pnpm test` 已接好（`d38e580`）。`native-filter.test.mjs` 照搬即可。
- **`page-state.mjs`** 的 `detectState`/`waitForState`（返回 `LIST`）= driver 第 8 步「等列表稳定」原语。

需补（交付物，增量、不破坏现有）：
- **worker 加一个一次性命令** `apply-native-filter`（payload 带 `nativeFilter` 配置 → 内部 `planNativeFilter` + `applyNativeFilter` → 回报告）+ 一个 `diagnose-filter` 探针（dump `.filter-panel` 结构 / `.vip-mask` 状态 / 各组 `.option` 文案 / 各组单选多选行为 / 零结果空态选择器），仿现有 `diagnose-reject`。IPC 透传已接受任意 `{type, ...params}`，**只需在 worker 的 `switch` 加 `case` + 可选 GUI 按钮**。这给 driver 一个「不跑整轮、单步打真账号」的回路，是目前唯一缺口。

  接线注意（Codex 查漏新增,务必遵守）：
  - **超时**：现有命令回复硬超时 **60s**（`OPEN_SETTING_WINDOW/ipc/index.ts:1038`）。`applyNativeFilter` 含人类光标多次点击 + `确定` 后 `waitForState`，可能逼近/超过 60s → 超时后父进程删掉 pending，worker 的迟到回复**变孤儿**（UI 见超时但浏览器状态已改）。须：给该命令**单独放大超时**（如按 `type` 定制或传 `timeoutMs`），并给 driver **自身有界 deadline**，driver 永远在 deadline 内返回报告而非挂起。
  - **协议 `ok` 与报告 `ok` 不可混淆**：fd4 协议里 `msg.ok:false` 表示**命令执行失败**（父进程 reject/丢弃 `result`，`ipc/index.ts:1010-1014,1042`）。driver 报告里的 `report.ok:false`（面板没开/降级）是**正常业务结果**。故命令 handler 必须 `reply(true, report)`——**即便 `report.ok===false` 也用协议成功**回传整个报告；协议 `false` 只保留给 worker 自身抛异常。
  - **frame 为空守卫**：worker 每命令重取 `recommendFrame`（`index.ts:102,123`），现有 frame 依赖命令都先判空（`index.ts:157,170`）。两个新命令同样：取不到 frame 时返回结构化 `{ ok:false, reason:'no-frame' }`，**不要拿 `null` 去调 driver**。

明确不做：offline/fixture（cheerio/jsdom）回放——现仓库无此设施，driver 与现有 reject driver 一样靠真账号手测；引入 fixture 回放超出本 spec。

## 测试

- **纯层 TDD**（`native-filter.test.mjs`，注入 fixture catalog）：`normalizeOption` 归一（`"\n 本科\n"`、内部空格/Tab、`null`/`undefined`、易冲突值）、catalog 文案解析、单选 vs 多选、不合法文案进 `skipped`、**全不合法 → 全 `skipped` 且 `apply` 空**、空值/`enabled:false` 产空计划（该维度**不进** `apply` 也**不进** `skipped`）、单选给数组取首个、多选给字符串包成数组。
- **driver**：薄 impure 层，靠 `apply-native-filter` 调试命令打真账号手测（见清单）。
- 不引新依赖。沿用 `node:test`。

### 实测清单（需真账号 + 浏览器，经 `apply-native-filter` 调试命令）

1. `nativeFilter` 写入 `candidate-filter.json`，含免费维度（学历/经验/薪资）。
2. 发 `apply-native-filter` → 面板打开、对应项点亮、点确定、列表刷新，报告 `ok:true` 且 `applied` 准确。
3. VIP 账号：含 VIP 维度（院校/活跃度）→ 折叠（幂等）展开、VIP 项生效，`applied` 含 VIP 维度。
4. 非 VIP 账号：含 VIP 维度 → VIP 项进 `skipped`（`vip-locked`），免费维度仍生效，**不报错不崩**。
5. 不合法文案 → 进 `skipped`（`unknown-option`），其余正常。
6. 重复发同一命令两次（幂等）：第二次因「清空再选」结果一致，不叠加旧选择。
7. 面板打不开（临时改坏触发器选择器模拟）→ 报告 `ok:false, reason:'panel-not-opened'`，不崩。
8. 空 plan / `enabled:false` → `ok:true, applied:[], skipped:[]`（与 #7 的 `ok:false` 可区分）。
9. 故意设极严筛选打到零结果 → `ok:true, listEmptyAfterApply:true`，driver 不挂起（验证空态分支）。

## 集成（非本 spec 决定，仅备注供后续 agent 参考）

- 推荐路径建议：在首次 `scrapeCards` **之前**调用一次；per-job 模式每个职位重设。
- **以上仅为建议，时序/频率/接线由后续另一个 agent 决定。** 本 spec 交付的代码不含该接线。

## 交付物清单

- `recommend/pure/native-filter.mjs`（含 `NATIVE_FILTER_CATALOG` / `normalizeOption` / `planNativeFilter`）+ `recommend/pure/native-filter.test.mjs`（新，注入 fixture catalog）
- `recommend/native-filter-driver.mjs`（新，签名 `applyNativeFilter(page, frame, cursor, plan)`，返回带 `ok/reason` 的报告）
- `constant.mjs`：新增面板选择器（增量）
- `default-config-file/candidate-filter.json`：补**最小** `nativeFilter` 默认（`{ "enabled": false }`，不塞满示例 9 键）（增量）
- `runtime-file-utils.mjs`：`jobFilterToCandidateFilter` 返回对象加 `nativeFilter` 透传（增量）+ 对应 `__jobFilterToCandidateFilter` 单测
- `BOSS_RECOMMEND_DEBUG_MAIN/index.ts`：加 `apply-native-filter` 与 `diagnose-filter` 两个 `case`（+ 可选 GUI 按钮）（增量，单步真账号回路）；`OPEN_SETTING_WINDOW/ipc/index.ts`：给 `apply-native-filter` 放大命令超时（>60s 或按 `type` 定制）
- **不改** `orchestrator.mjs` 主循环控制流。

## Opus review 已并入的必改/应改点（供 Codex 查漏对照）

- per-job `nativeFilter` 来源与 `jobFilterToCandidateFilter` 静默丢键问题（已写死来源 + 透传补丁）
- driver 签名 `(page, frame, cursor, plan)`（非单 `target`）
- `normalizeOption` 纯层单一来源、planner 与 driver 共用（DOM 文本带空白换行）
- 确定按钮按文案正向匹配、class 排除仅回退
- 点完正向验证选中态 → `applied` 反映观测而非点击；present-but-inert 记 `click-no-effect`
- 折叠区幂等展开（先读状态再点）
- 清空再选（`.default.option`）保证调用幂等、单选无残留
- 报告含 `ok/reason`，区分「面板没开/崩」与「plan 为空」
- 默认配置最小化（`{enabled:false}`）；catalog 作参数注入便于单测

## Codex 查漏补缺已并入（第二轮）

- 调试命令 60s 超时 vs driver 时长：放大超时 + driver 有界 deadline，杜绝孤儿回复
- fd4 协议 `ok:false`（命令失败）与 driver `report.ok:false`（业务降级）不可混淆 → handler `reply(true, report)`
- 确定后**零结果空态屏**是合法终态：等 "LIST 或 空态" 任一，`listEmptyAfterApply` 标记，不死等 `LIST`
- 顶层 scope 段残留的旧 `(target, cursor, plan)` 签名 → 统一为 `(page, frame, cursor, plan)`
- `plan.apply[].options` 单一约定＝原始 catalog 文案；归一只在运行期比对时双边各做一次
- 整组回读验证替代逐点记录 → 兼容单选自动反选；`single` 真值用 `diagnose-filter` 核对
- `major` 等组 `.option` 可能嵌 `.popover` 包裹 → 用后代选择器
- 两个新命令 frame 为空守卫 → 返回 `reason:'no-frame'`，不拿 `null` 调 driver
- 报告 `skipped.reason` 收敛为三种，去掉无意义的 `'empty'`；术语 `enabled:false` 全文一致
- 单测补全不合法/空 plan、`normalizeOption` 的 `null`/内部空白边界
