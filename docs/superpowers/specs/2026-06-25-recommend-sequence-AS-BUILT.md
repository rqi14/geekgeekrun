# 推荐牛人 · 选人 Sequence —— AS-BUILT（截至 2026-06-25）

> 经过 Opus 对抗性评审（Codex 中途死掉，仅采纳其已捕获发现）后落地的实际实现。
> 核心定调：**卡片层默认纯规则、运行时 LLM 只在 canvas 精评必需**——Opus 担心的
> "绝对分 triage 跨批校准 / 压缩 rubric 丢例外 / 分 batch" 三个坑因此整层不存在。

## 漏斗（as-built）

```
Layer-0  操作基座 applyNativeFilter（服务端原生筛选，gated on enabled）
  ↓
A 收集（免费，拟人滚动 scrollGently）
   scrapeCards → ruleFilterList（薪资带/城市/学历/屏蔽名，命中点X）
   → fieldKnockout（专业/方向 include/exclude 关键词；命中排除且无包含→跳过，不点X）
   → 灰区默认入池；按 学校层级rank×1000 + cheapPrescore 排序
  ↓
B 开简历（烧查看额度，min(per-job, 真实剩余)）
   scrollCardIntoView → clearCapturedText → openResume → assertIdentity
   → captureResumeText（canvas 全文，稳定等待 9s/3稳）→ 身份交叉校验(含姓名/学校)
   → score（evaluateResumeByRubric 完整 rubric）
  ↓
C 选最优 + 打招呼（烧沟通额度）
   canvasOk===false 的人剔除（fail-closed，绝不靠抓空/串号简历打招呼）
   → selectForGreet（≥passThreshold；同分优先"刚刚活跃"）→ greetFromCard
```

贯穿：起跑 readQuota seed 预算；guard() 每动作前 detectState **+ URL 守卫**（离开
`/web/chat/recommend` 导航回）；business-block 弹窗=硬兜底。`greet<=0 || view<=0`
起跑即返回（不空滚空开烧查看）。

## 已实现组件（均 TDD，191 纯逻辑测试绿）

| 组件 | 文件 | commit |
|------|------|--------|
| 学校层级数据(3018校)+生成器 | `recommend/data/cn-school-tier.json` + `build-school-tier.mjs` | bdfdbdd |
| school-tier 查询(985/211/双一流/本科/专科, 别名+前缀匹配) | `recommend/school-tier.mjs` | bdfdbdd |
| field-knockout(include 压过 exclude, 灰区默认开, 位置感知防子串误判) | `recommend/pure/field-knockout.mjs` | c61896c |
| selectForGreet 活跃度 tie-break | `recommend/pure/selection.mjs` | 9d2d18c |
| scraper expect label(期望/最近关注)+expectDirection | `list-scraper.mjs`+`card-mapper.mjs` | 4c75cc2 |
| 配额 min 分配 + greet/view=0 早退 + passThreshold 对齐 + canvas fail-closed | `orchestrator.mjs`+`run-config.mjs`+`resume-inspector.mjs` | 8a57828 |
| field-knockout 进 A 相 + school-tier 排序 + 配置透传 | `orchestrator.mjs`+`run-config.mjs`+`candidate-filter.json` | 3838084 |

（更早：弹窗识别/quota-reader/canvas 全文提取/dry-run/native-filter 接线 等见前序 commit。）

## 评审 blocker 处置

- **passThreshold 被忽略 / 与失败兜底打架** → run-config 令 `minScoreToChat = rubric.passThreshold`（用户显式值优先）；打招呼门与 scorer-gate 失败兜底共用同一阈值 → 一致 fail-closed。✓
- **烧查看换 0 招呼** → `greet<=0||view<=0` 早退；fieldKnockout 在开简历前剔除不对口。✓
- **canvas 静默退薄文本** → 稳定等待加强 + 身份交叉校验 + canvasOk===false 不打招呼（不标 hardReject，避免误点不合适）。✓
- **多岗位配额竞态** → `min(per-job cap, 真实剩余)`；business-block 仍为权威硬兜底。部分缓解（跨进程仍靠 business-block 兜底；未做"当天耗尽全局标记"）。
- **LLM 绝对分跨批 / 压缩 rubric** → 取消该层（卡片纯规则），坑消失。✓

## 配置（candidate-filter.json / per-job filter）

```json
{
  "fieldRules": { "include": ["化工","材料","微球","乳化","液滴微流控","自组装","冻干","..."],
                  "exclude": ["分子生物","细胞生物","免疫","CRISPR","..."] },
  "schoolFloorRank": 0   // 预留：硬学校下限(985=5..专科=1)，当前仅排序用、未强制
}
```
scoring（boss-recruiter.json / per-job）：`scoring.enabled` + 存好的 `scoring.rubric`
（含 `passThreshold`）。**rubric 一次性生成存盘**，不要每轮从 JD 现生成（否则分数不可比）。

## 未决 / 后续（不阻塞）
- 跨午夜配额重置、打招呼"成功≠送达"、business-block 视图/沟通双弹窗区分 —— 评审提到，未做，靠 business-block 兜底。
- dry-run 渲染端未展示 `fieldKnockedOut`/`schoolRank`（数据已在 report，UI 可补）。
- `schoolFloorRank` 硬下限未强制（仅排序）。
- 灰区是否过一次便宜 LLM（可选增强）——未做，默认纯规则。

## 真机验证（零额度）
调试工具 → 推荐牛人页 → 配一个带 rubric 的职位 + 在 candidate-filter 配 fieldRules →
「测试 Sequence（不打招呼）」。看：fieldKnockedOut、各人 schoolRank、canvasOk、
score+reason（passThreshold 生效后不再人人入选）。
