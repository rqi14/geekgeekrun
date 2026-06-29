# Recruiter Side - Holistic IA / UX Review

> Written: 2026-06-29
> Branch reviewed: feat/recruiter-filter-config-refactor
> Scope: recruiter-side pages only. No code was modified.

---

## 1. Page-Responsibility Map

| Page | What It Owns | Config Written |
|---|---|---|
| **BossJobConfig** (职位配置) | 4-section per-job: (1) card preFilter (2) AI Rubric - single editable source (3) recommend behavior: scoringEnabled, minScore, onScoreError, skipViewed (4) chat behavior: llmFilterEnabled, keywords | boss-jobs-config.json |
| **RecommendAutomation** (推荐牛人) | Solo-run launch. ScoringTab = global fallback scoring. CardFilterTab = global fallback card filter. BudgetTab = pace limits. RunTab = solo lifecycle. | boss-recruiter.json + candidate-filter.json |
| **BossChatPage** (沟通) | Solo chat-run launch + chat run-strategy. ALSO duplicates job queue table -- should not be here. | boss-recruiter.json chatPage + boss-jobs-config.json |
| **BossAutoSequence** (自动顺序执行) | Per-job queue table (canonical). Queue launch. Run-strategy delegated via links. | boss-jobs-config.json |
| **BossLlmConfig** (配置大语言模型) | LLM provider/model registry, purpose assignment, retry settings. | boss-llm.json |
| **WebhookIntegration** | Webhook config. | webhook.json |
| **BossDebugTool** | Test harness only. | none |
| **BossConfigManager** (配置管理) | Export/import all config files. | all |

---

## 2. Overlap and Confusion Matrix

### 2a. Duplicated Config Surfaces

**Card pre-filter (city, education, experience, salary)**
- Primary: BossJobConfig/index.vue lines 31-224, per-job section (1)
- Duplicate: RecommendAutomation/CardFilterTab.vue -- labeled global fallback in alert but fully editable
- Problem: Per-job wins when jobId passed; global wins for solo-run with no job. User cannot tell which is active.

**Card filter keywords (skill, school, major, blockName)**
- Primary: BossJobConfig/index.vue lines 186-224, per-job preFilter
- Duplicate: RecommendAutomation/CardFilterTab.vue lines 63-106, global candidate-filter.json
- Problem: Identical fields split across two pages writing to different JSON keys.

**AI Rubric (complete visual editor)**
- Primary: BossJobConfig/index.vue lines 226-410, full visual editor with JD input, auto-generate, dimension editor, passThreshold
- Duplicate: RecommendAutomation/ScoringTab.vue lines 1-60, JD text area + enabled switch + minScore + model selector
- Problem: ScoringTab notes rubric editing is in BossJobConfig, yet JD/model/threshold controls still exist here writing to boss-recruiter.json scoring (different key from per-job filter.rubric).

**scoringEnabled switch**
- Primary: BossJobConfig/index.vue line 420, job.filter.recommendScoringEnabled
- Duplicate: RecommendAutomation/ScoringTab.vue line 28, model.enabled
- Problem: Different keys, different files. Per-job takes precedence (runtime-file-utils.mjs lines 360-373). Global switch has no effect when per-job rubric is configured.

**Job queue table (sequence.enabled / runRecommend / runChat per job)**
- Primary: BossAutoSequence/index.vue lines 5-41
- Duplicate: BossChatPage/index.vue lines 5-43 -- identical el-table with same three columns
- Problem: EXACT DUPLICATION. Both call save-boss-jobs-config IPC.

**skipViewedCandidates**
- Primary: BossJobConfig/index.vue lines 445-450, section (3) per-job recommend block
- Duplicate: RecommendAutomation/CardFilterTab.vue line 115-118, global
- Problem: Writes to different storage keys. Per-job wins.

### 2b. Confusingly-Placed Controls

**Job queue table in BossChatPage** (BossChatPage/index.vue lines 5-43)
A chat page showing an execute-recommend column. Users opening chat run-strategy encounter a job-queue editor. Most disorienting placement in the app.

**ScoringTab / CardFilterTab labeled as primary config** (RecommendAutomation/index.vue lines 5-8)
The global-fallback alert is invisible until the tab is opened. At nav level these look like primary surfaces, not fallbacks.

**chatKeywordsEnabled / chat resume keyword match** (BossJobConfig/index.vue lines 458-480, section 4)
Looks like a near-duplicate of card-level expectSkillKeywords. Pass-only semantics make it feel weaker and redundant. No explanation that full-resume text is a different scope from card fields.

**persistProfile** (RecommendAutomation/RunTab.vue lines 57-70)
Global browser setting affecting ALL runs. Only has UI in recommend RunTab. Chat-page solo runs also affected with no equivalent UI.

**Model selector inside rubric section** (BossJobConfig/index.vue lines 237-265)
Second place to pick a model, separate from BossLlmConfig purpose-assignment. No cross-reference shown.

**Disabled regex stub** (BossJobConfig/index.vue lines 482-495)
Disabled form item in production UI leaking unfinished feature intent.

---

## 3. Resolution Status (updated 2026-06-29)

Sections 1-2 describe the state *before* consolidation. The issues were resolved in
two passes: commit `0f4232e` (UI consolidation) and the follow-up cleanup below.

| Issue (from §2) | Status | Where |
|---|---|---|
| Card pre-filter duplicate (CardFilterTab) | ✅ Resolved | Tab removed from RecommendAutomation (`0f4232e`); `CardFilterTab.vue` deleted |
| Card keyword duplicate (skill/school/major) | ✅ Resolved | Only in BossJobConfig § ① now |
| AI Rubric duplicate (ScoringTab) | ✅ Resolved | Tab removed (`0f4232e`); `ScoringTab.vue` deleted. Rubric single-source in BossJobConfig § ② |
| `scoringEnabled` duplicate switch | ✅ Resolved | Only `recommendScoringEnabled` per-job in BossJobConfig § ③ |
| Job queue table in BossChatPage | ✅ Resolved | Removed (`0f4232e`); canonical queue only in BossAutoSequence |
| `skipViewedCandidates` duplicate | ✅ Resolved | Only per-job in BossJobConfig § ③; RecommendAutomation no longer writes the global key |
| ScoringTab/CardFilterTab look like primary | ✅ Resolved | Files gone; RecommendAutomation is budget + run only |
| chat resume keyword-match (pass-only) | ✅ Resolved | Removed from BossJobConfig § ④ (`0f4232e`); dead fields purged from interface/parse |
| Disabled regex stub | ✅ Resolved | Removed from BossJobConfig (`0f4232e`) |
| Model selector cross-ref to BossLlmConfig | ✅ Already present | BossJobConfig § ② shows the `purposeDefaultModelId.rubric_generation` hint |
| `persistProfile` only in recommend RunTab | ⬜ Deferred | Global browser setting still edited only from RecommendAutomation; chat solo-runs inherit it silently. Moving to a global surface is a UX decision left to the owner |

### Follow-up cleanup (this pass)
- Deleted now-orphaned files: `RecommendAutomation/{CardFilterTab,ScoringTab,FilterRuleRow}.vue`.
- `RecommendAutomation` mapping (`mapping.mjs`/`mapping.d.ts`) trimmed to `{ budget, run }`.
  `toSavePayload` no longer emits `scoring` / `candidate-filter` keys, so saving the page
  cannot silently overwrite the per-job-superseded global fallback (the IPC merges by key,
  so omitted keys keep their stored values).
- Removed the JD-warning dialog and regex-validation gate from `RecommendAutomation/index.vue`
  — both read global config the page no longer displays.

### Resulting IA (one place per thing)
- **职位配置 (BossJobConfig)** — all per-job filtering: ① card pre-filter, ② AI Rubric (single source), ③ recommend behavior, ④ chat LLM filter.
- **推荐牛人 (RecommendAutomation)** — run budget / pace + launch only.
- **沟通 (BossChatPage)** — chat run-strategy + launch only.
- **职位执行队列 (BossAutoSequence)** — the one canonical per-job queue.
- **配置大语言模型 (BossLlmConfig)** — model registry + purpose assignment.
