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
- 一个 impure driver：`applyNativeFilter(target, cursor, plan)` —— 打开面板、按计划点选项、点确定、等列表稳定，返回「实际生效/被跳过」报告
- `constant.mjs` 选择器
- `candidate-filter.json` 的 `nativeFilter` 配置 schema + per-job 透传

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

## 组件设计

### 1. 纯 planner + catalog — `recommend/pure/native-filter.mjs`（+ `.test.mjs`，TDD）

- `NATIVE_FILTER_CATALOG`：每个维度 → `{ groupClass, vip:boolean, single:boolean, options: string[] }`。
  - 免费：`degree`(多)、`experience`(多)、`intention`(多)、`salary`(单)
  - VIP：`activation`(单)、`school`(多)、`major`(多)、`gender`(多)、`switchJobFrequency`(单)
  - `options` 为面板精确文案数组（如 degree：`['初中及以下','中专/中技','高中','大专','本科','硕士','博士']`）。
- `planNativeFilter(nativeFilterCfg)` → `{ apply: [{ group, single, options: string[] }], skipped: [{ group, value, reason }] }`
  - 纯函数、**VIP 无关**：只把配置里的取值对着 catalog 解析、归一（trim）、校验是否合法文案。
  - 不合法文案 → 进 `skipped`（`reason:'unknown-option'`），不抛错。
  - 空值/`enabled:false` → 该维度不进 `apply`。
  - 单选维度给了数组只取第一个；多选维度给了字符串当单元素数组。
  - VIP 门禁**不在纯层判断**（运行期才知道有没有 VIP），由 driver 决定，保证纯层确定可测。

### 2. driver（impure）— `recommend/native-filter-driver.mjs`

仿 `actions.mjs` / `resume-inspector.mjs` 风格（ghost-cursor、`sleepWithRandomDelay`）。

`applyNativeFilter(target, cursor, plan)`：

1. 点面板触发器打开 `.filter-panel`，等面板可见。
2. 若 `plan.apply` 含任一 VIP 维度 → 点 `vip-folded` 展开折叠区。
3. **运行期 VIP 门禁**：检测 `.vip-mask`（或 VIP 组不可点）。若 VIP 不可用，则 VIP 维度整体跳过并记入报告（这就是「有时有 VIP」的优雅降级路径）。
4. 对每个仍要应用的维度：定位 `.check-box.<groupClass>` → 按**精确 trim 文案**点 `.option`（单选点一个；多选逐个点）。
5. 点 **确定**（`div.btns > div.btn`，非 `default`/`btn-outline` 的那个）。
6. 等列表回到 `LIST` 稳定状态（复用 `page-state` 的判定）。
7. 返回 `{ applied: [...], skipped: [...] }`，由调用方（之后接线时）经 `hooks` 记录。

健壮性：整个 driver 包 try/catch；任何失败 → 记录并返回「未应用」，**绝不让整轮崩**（与 PR「无效正则不让整轮崩」一致）。driver 不读配置、不碰预算、不决定调用时机 —— 纯粹「按给定 plan 操作面板一次」。

### 3. 选择器 — `constant.mjs`

新增（具体值在实现时对真实站点核对）：

- 面板触发器：`#headerWrap … .recommend-filter.op-filter` 内的触发 `div`
- 面板：`.filter-panel`
- VIP 折叠展开：`.vip-filters-wrap .vip-folded`
- VIP 锁标识：`.vip-filters-wrap .vip-mask`
- 维度组：`.check-box.<degree|experience|intention|salary|activation|school|major|gender|switchJobFrequency>`，组内选项 `.option`（`.default.option` 是「不限」复位项）
- 确定：`.filter-panel .btns .btn`（排除 `.default`）；清除：`.filter-panel .btns .btn.btn-outline.default`

> 实现第一步先核对：`#headerWrap … recommend-filter` 在主页面还是 `recommendFrame`（职位下拉注释说主页面，但推荐内容在 iframe）。driver 的 `target` 参数对准面板**实际所在的 frame/page**。

### 4. per-job 透传 — `runtime-file-utils.mjs`

`jobFilterToCandidateFilter` 增加 `nativeFilter` 到透传白名单（与现有 `expectSchoolKeywords` 等同样处理），使顺序执行队列的 per-job 配置也带上 `nativeFilter`。**仅透传，不决定何时用。**

## 测试

- **纯层 TDD**（`native-filter.test.mjs`）：catalog 文案解析、单选 vs 多选归一、不合法文案进 `skipped`、空/`disabled` 产空计划、单选给数组取首个、多选给字符串包成数组。
- **driver**：薄 impure 层，靠真账号手测（见清单）。
- 不引新依赖。沿用 `node:test`。

### 实测清单（需真账号 + 浏览器）

1. `nativeFilter` 写入 `candidate-filter.json`，含免费维度（学历/经验/薪资）。
2. 手动调用 `applyNativeFilter`（或最小 harness）→ 面板打开、对应项点亮、点确定、列表刷新。
3. VIP 账号：含 VIP 维度（院校/活跃度）→ 折叠展开、VIP 项生效，报告 `applied` 含 VIP 维度。
4. 非 VIP 账号：含 VIP 维度 → VIP 项进 `skipped`（reason VIP 锁），免费维度仍生效，**不报错不崩**。
5. 给一个不合法文案 → 进 `skipped`（`unknown-option`），其余正常。

## 集成（非本 spec 决定，仅备注供后续 agent 参考）

- 推荐路径建议：在首次 `scrapeCards` **之前**调用一次；per-job 模式每个职位重设。
- **以上仅为建议，时序/频率/接线由后续另一个 agent 决定。** 本 spec 交付的代码不含该接线。

## 交付物清单

- `recommend/pure/native-filter.mjs` + `recommend/pure/native-filter.test.mjs`（新）
- `recommend/native-filter-driver.mjs`（新）
- `constant.mjs`：新增面板选择器（增量）
- `default-config-file/candidate-filter.json`：补 `nativeFilter` 默认（空/disabled）（增量）
- `runtime-file-utils.mjs`：`jobFilterToCandidateFilter` 透传 `nativeFilter`（增量）
- **不改** `orchestrator.mjs` 主循环控制流。
