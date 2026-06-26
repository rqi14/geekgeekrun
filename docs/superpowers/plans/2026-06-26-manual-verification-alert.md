# Manual Verification Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable Windows-visible alert when BOSS/Zhipin manual verification is detected, while keeping the portable build viable.

**Architecture:** Introduce one reusable Electron alert helper in `@geekgeekrun/boss-auto-browse-and-chat`, then replace duplicated direct `Notification` calls with that helper. The helper shows a system notification when supported, falls back to `dialog.showMessageBox`, and throttles repeated alerts so a stuck verification page does not spam the user.

**Tech Stack:** Electron main process APIs, ESM Node modules, Playwright Test for browser/mock verification, existing TypeScript worker flows.

---

### Task 1: Playwright Mock Test For Alert Behavior

**Files:**
- Create: `tests/manual-verification-alert.playwright.spec.mjs`
- Modify: `package.json`

- [x] **Step 1: Add a failing Playwright test**
- [x] **Step 2: Add a test script**
- [x] **Step 3: Verify RED**

Run:

```powershell
pnpm test:manual-verification-alert
```

Expected: fail because `packages/boss-auto-browse-and-chat/manual-verification-alert.mjs` does not exist yet.

### Task 2: Implement Reusable Alert Helper

**Files:**
- Create: `packages/boss-auto-browse-and-chat/manual-verification-alert.mjs`
- Test: `tests/manual-verification-alert.playwright.spec.mjs`

- [x] **Step 1: Write minimal helper**
- [x] **Step 2: Verify GREEN**

Run:

```powershell
pnpm test:manual-verification-alert
```

Expected: all Playwright tests pass.

### Task 3: Wire Helper Into Verification Flows

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/risk-detector.mjs`
- Modify: `packages/ui/src/main/flow/BOSS_CHAT_PAGE_MAIN/index.ts`
- Modify: `packages/ui/src/main/flow/BOSS_AUTO_BROWSE_AND_CHAT_MAIN/index.ts`
- Modify: `packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts`

- [x] **Step 1: Replace direct Notification blocks**
- [x] **Step 2: Add read-no-reply safe verification alert**
- [x] **Step 3: Run focused verification**

Run:

```powershell
pnpm test:manual-verification-alert
pnpm --filter geekgeekrun-ui typecheck:node
```

Expected: Playwright test passes and node typecheck passes.

Actual: Playwright test passes. Full `geekgeekrun-ui typecheck:node` currently fails on many pre-existing unrelated TypeScript errors across untouched files, so this change also uses `node --check` for the new helper and `typescript.transpileModule` on the touched worker files as focused verification.

### Task 4: Final Review And PR

- [ ] **Step 1: Inspect diff**
- [ ] **Step 2: Commit**
- [ ] **Step 3: Push and open PR**
