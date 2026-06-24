# Handoff — 原生筛选能力层（给"负责设计 sequence 的 agent"）

> 一句话：我做了一个**通用、无意见的原语** `applyNativeFilter(page, frame, cursor, plan)`，它能把 BOSS 推荐页的原生「筛选」面板按给定计划设好并如实汇报结果。**它不决定什么时候用、用几次、放主循环哪——那是你的活。** 本文告诉你这块能力长什么样、怎么调、边界在哪。

分支：`feat/recommend-native-filter`（独立 worktree，基于 PR #10 `feat/recommend-page-redesign`）。
完整设计：`docs/superpowers/specs/2026-06-24-native-filter-panel-design.md`（经 Opus + Codex 两轮 review）。

## 这块能力提供什么

服务端预筛（Layer-1 漏斗）。原生面板能按 学历/经验/意向/薪资（免费）+ 院校档次/专业大类/活跃度/性别/跳槽频率（VIP「高级筛选」）改变**列表里出现谁**。设一次，BOSS 直接少推不相关的人。

**为什么对你（sequencing）重要**：配额极小且硬性——每日「主动查看」免费 20 / VIP 120，每日「沟通」免费 3 / VIP 60。每次开简历、每次打招呼都烧稀缺配额。源头预筛 = 你花配额开的简历本身就更相关。预算越小，越该先筛后跑。

## 接口（你会调的东西）

```
import { planNativeFilter } from './recommend/pure/native-filter.mjs'      // 纯函数
import { applyNativeFilter } from './recommend/native-filter-driver.mjs'   // impure

const plan = planNativeFilter(cfg.nativeFilter)        // cfg.nativeFilter 来自 candidate-filter.json
const report = await applyNativeFilter(page, frame, cursor, plan)
```

`report` 形状：
```js
{
  ok: true|false,                         // false = 面板没开/无frame/崩（业务级，不是异常）
  reason: undefined|'panel-not-opened'|'no-frame'|'driver-error',
  applied: [{ group, options:[...] }],    // 实测确实选中的（整组回读，诚实）
  skipped: [{ group, value, reason }],    // 'unknown-option'|'vip-locked'|'click-no-effect'
  listEmptyAfterApply: false|true         // 确定后筛到 0 人（合法终态，不是错误）
}
```

## 关键性质（你做时序时要知道）

- **幂等**：每次调用先点「不限」清空再选，重复调用结果一致、不叠加。所以你可以 per-job 反复重设，不用担心残留。
- **绝不崩**：任何失败都返回 `ok:false` 报告，不抛异常打断你的循环（与 PR「无效正则不让整轮崩」一致）。
- **VIP 自适应**：运行期检测 VIP 锁，没 VIP 就把 VIP 维度记 `vip-locked` 跳过，免费维度照常生效。你不用提前判断有没有 VIP。
- **自带有界超时**：driver 永远在 deadline 内返回，不会让你的循环挂死（包括筛到 0 人的空态）。
- **不读配置、不碰预算、不滚动、不开简历**：纯粹"操作面板一次"。`page`=开面板（主页面），`frame`=确认列表刷新（iframe）。

## 留给你决定的（我故意没做）

- **何时调用**：建议（非约束）首次 `scrapeCards` 之前调一次；per-job 模式每个职位重设。你按波次/预算/风控自行定。
- **调用几次 / 失败重试 / 退化策略**：`report.ok:false` 或 `listEmptyAfterApply` 时你想怎么办（放宽筛选？跳过？告警？）由你定。
- **orchestrator 接线**：我**没改** `orchestrator.mjs` 主循环。调用点你来插。
- **预算交互**：`applied`/`listEmptyAfterApply` 是给你做"要不要继续烧配额"判断的信号，怎么用你定。

## 配置来源（你取 plan 的地方）

- 全局/单跑：`candidate-filter.json` 的 `nativeFilter` 块（原样透传，已通）。
- per-job：`boss-jobs-config.json` 的 `jobs[].filter.nativeFilter`，经 `jobFilterToCandidateFilter` 透传（我加了这行）。

## 调试（你验证时序时能用）

worker 新增一次性命令 `apply-native-filter`（单步打真账号，不跑整轮）+ `diagnose-filter`（dump 面板结构）。在「招聘端调试工具 → 推荐牛人页」。

## 交付物（都在本分支，增量、不碰你的主循环）

`recommend/pure/native-filter.mjs`(+test)、`recommend/native-filter-driver.mjs`、`constant.mjs` 选择器、`candidate-filter.json` 默认 `{enabled:false}`、`runtime-file-utils.mjs` 透传、`BOSS_RECOMMEND_DEBUG_MAIN` 两命令。
