# 招聘端多账号与跨账号串行执行设计

日期：2026-06-30

## 背景

招聘端当前已经支持按岗位配置独立的筛选、Rubric、推荐牛人评分、沟通页筛选，以及自动顺序执行岗位队列。现有缺口是“招聘账号”还不是一等配置域：配置、岗位、Cookie、localStorage、持久化 Chrome profile 都默认只有一套全局文件。

目标是在现有多岗位模型外增加账号维度：

```text
招聘账号 -> 账号自己的岗位配置 -> 账号自己的岗位队列 -> 推荐牛人/沟通串行执行
```

跨账号执行固定为串行：

```text
账号 A 跑完自己的岗位队列
账号 B 跑完自己的岗位队列
账号 C 跑完自己的岗位队列
```

## 目标

- 左侧招聘端 pane 增加当前账号切换入口。
- 支持新增、重命名、删除、启用/停用招聘账号。
- 每个招聘账号拥有独立的登录态、岗位列表、岗位筛选/Rubric/sequence 配置。
- 新增“多账号自动执行”页面，用户勾选要执行的账号后，自动串行跑完所有选中账号。
- 兼容现有单账号用户：首次升级时把现有全局招聘端配置迁移为默认招聘账号。
- 保持现有“推荐牛人”“沟通”“自动顺序执行”的核心行为，单账号运行时只作用于当前选中账号。

## 非目标

- 不做跨账号并行执行。
- 不重做 sqlite 业务数据模型；运行记录可以先通过 worker 消息和日志显示账号维度，数据库字段改造作为后续增强。
- 不把求职端账号纳入本次设计。
- 不重做 LLM provider 管理。第一版默认 LLM 配置仍可全局共享；若后续需要账号独立 LLM，可沿用相同配置域机制扩展。

## 数据模型

新增账号索引文件：

```text
~/.geekgeekrun/config/recruiter-accounts.json
```

示例：

```json
{
  "version": 1,
  "currentAccountId": "default",
  "accounts": [
    {
      "id": "default",
      "name": "默认招聘账号",
      "enabled": true,
      "createdAt": "2026-06-30T00:00:00.000Z",
      "updatedAt": "2026-06-30T00:00:00.000Z"
    }
  ]
}
```

每个账号有独立配置目录和存储目录：

```text
~/.geekgeekrun/config/recruiter-accounts/<accountId>/
  boss-recruiter.json
  candidate-filter.json
  boss-jobs-config.json

~/.geekgeekrun/storage/recruiter-accounts/<accountId>/
  boss-cookies.json
  boss-local-storage.json
  boss-chrome-profile/
```

保留现有全局文件作为迁移来源和兼容兜底：

```text
~/.geekgeekrun/config/boss-recruiter.json
~/.geekgeekrun/config/candidate-filter.json
~/.geekgeekrun/config/boss-jobs-config.json
~/.geekgeekrun/storage/boss-cookies.json
~/.geekgeekrun/storage/boss-local-storage.json
```

## 迁移策略

首次读取账号索引时，如果 `recruiter-accounts.json` 不存在：

1. 创建 `default` 账号。
2. 将现有招聘端配置文件复制到 `config/recruiter-accounts/default/`。
3. 将现有招聘端登录态复制到 `storage/recruiter-accounts/default/`。
4. 写入 `currentAccountId: "default"`。

迁移只复制，不删除旧文件。这样旧版本回滚仍能继续使用旧路径。

## Runtime API

在 `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs` 增加账号感知 helper：

- `readRecruiterAccountsConfig()`
- `writeRecruiterAccountsConfig(config)`
- `getCurrentRecruiterAccountId()`
- `setCurrentRecruiterAccountId(accountId)`
- `resolveRecruiterAccountPaths(accountId)`
- `readRecruiterAccountConfigFile(accountId, fileName)`
- `writeRecruiterAccountConfigFile(accountId, fileName, content)`
- `readRecruiterAccountStorageFile(accountId, fileName, opts)`
- `writeRecruiterAccountStorageFile(accountId, fileName, content, opts)`
- `readBossJobsConfig({ accountId })`
- `writeBossJobsConfig(config, { accountId })`
- `getMergedJobConfig(jobId, { accountId })`

兼容原则：

- 未传 `accountId` 时默认使用 `currentAccountId`。
- 如果账号索引不存在，先执行迁移。
- 现有调用点可以分批迁移，第一阶段通过默认账号保持行为一致。

## 浏览器 Profile

`buildRecruiterLaunchOptions` 接收 `accountId`：

```ts
buildRecruiterLaunchOptions({ accountId })
```

当 `advanced.persistProfile === true` 时，profile 路径改为：

```text
~/.geekgeekrun/storage/recruiter-accounts/<accountId>/boss-chrome-profile
```

非持久 profile 模式继续使用 Cookie/localStorage 注入，但读取对应账号的存储文件。

## Worker 参数

招聘端 worker 增加命令行参数：

```text
--account-id=<accountId>
```

影响以下 worker：

- `bossRecommendMain`
- `bossChatPageMain`
- `bossAutoBrowseAndChatMain`
- 新增 `bossMultiAccountSequenceMain`

`runCommon` 增加参数：

```ts
runCommon({ mode, jobId, accountId })
```

单账号页面运行时传当前账号；多账号页面运行时由新 worker 内部逐账号串行调度。

## UI 设计

### 左侧 Pane：账号切换

在招聘端导航组顶部增加账号切换区：

```text
招聘BOSS
  当前账号：[账号下拉]
  账号管理
  账号配置
  岗位配置
  推荐牛人
  沟通
  自动顺序执行
  多账号自动执行
```

账号下拉显示启用账号，切换后：

- 调用 `set-current-recruiter-account`
- 刷新当前招聘端页面读取的数据
- 所有配置保存到该账号目录

账号管理可放在下拉旁的设置按钮或独立导航项，支持：

- 新增账号
- 重命名账号
- 启用/停用账号
- 删除账号
- 复制当前账号配置创建新账号

删除账号要求至少保留一个账号。删除前提示会删除该账号本地 Cookie/localStorage/profile 和岗位配置。

### 多账号自动执行页面

新增路由：`BossMultiAccountSequence`

页面结构：

- 账号执行列表
- 每个账号一行：
  - 勾选框
  - 账号名称
  - 启用状态
  - 岗位数
  - 已纳入 sequence 的岗位数
  - 登录态提示
  - 最近一次运行状态
- 操作区：
  - 开始串行执行
  - 停止任务
  - 仅执行启用账号

运行规则：

1. 用户勾选账号。
2. 点击开始。
3. 新 worker 获取账号列表快照。
4. 对每个账号：
   - 发送进度：`account-started`
   - 按该账号自己的 `boss-jobs-config.json` 读取 sequence 队列
   - 执行推荐牛人和沟通页
   - 成功后发送 `account-completed`
5. 如果某账号失败：
   - 记录失败原因
   - 关闭该账号浏览器
   - 继续下一个账号
6. 全部账号结束后发送总结果。

停止任务时：

- 当前账号 worker 尝试停止并关闭浏览器。
- 后续账号不再启动。
- UI 标记为用户中止。

## IPC

新增账号管理 IPC：

- `fetch-recruiter-accounts`
- `create-recruiter-account`
- `update-recruiter-account`
- `delete-recruiter-account`
- `get-current-recruiter-account`
- `set-current-recruiter-account`
- `copy-current-recruiter-account`

现有招聘端 IPC 增加可选 `accountId`：

- `fetch-boss-recruiter-config-file-content`
- `save-boss-recruiter-config`
- `fetch-boss-jobs-config`
- `save-boss-jobs-config`
- `sync-boss-job-list`
- `run-boss-recommend`
- `run-boss-chat-page`
- `run-boss-auto-browse-and-chat`
- `export-recruiter-config`
- `import-recruiter-config`

新增跨账号执行 IPC：

- `run-boss-multi-account-sequence`
- `stop-boss-multi-account-sequence`

## 导入导出

第一版保留现有导入导出 UI，但增加账号作用域：

- 当前账号导出：导出当前账号配置、岗位、登录态。
- 当前账号导入：导入到当前账号。

多账号导入导出可作为后续增强，避免第一版 bundle 格式膨胀。

## 错误处理

- `accountId` 不存在：提示账号不存在，拒绝运行。
- 当前账号未登录：单账号运行按现有登录失效流程处理。
- 多账号运行中某账号未登录：标记该账号失败，继续下一个账号。
- 岗位队列为空：标记该账号跳过，继续下一个账号。
- 配置文件损坏：回退默认配置并在 UI 显示警告。
- 删除当前账号：删除后自动切换到剩余第一个启用账号。

## 测试计划

纯逻辑测试：

- 账号索引不存在时创建 default 并迁移现有文件。
- `resolveRecruiterAccountPaths` 只返回账号目录内路径。
- `readBossJobsConfig({ accountId })` 按账号隔离。
- `getMergedJobConfig(jobId, { accountId })` 读取目标账号岗位配置。
- 删除账号时至少保留一个账号。
- 多账号执行计划生成：只包含勾选账号，并保持用户勾选顺序。

UI/IPC 测试：

- 切换账号后岗位配置页面读取不同账号的 jobs。
- 保存岗位配置只影响当前账号。
- 多账号自动执行页面能显示账号列表、勾选、启动、停止。

人工验证：

- 从旧版本配置启动，确认自动生成默认账号。
- 新增两个账号，分别登录并同步岗位，确认岗位列表互不影响。
- 勾选两个账号执行，确认日志顺序为账号 A 完成后账号 B 开始。
- 故意让账号 A 登录失效，确认账号 B 仍继续执行。

## 关键文件

- `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs`
- `packages/boss-auto-browse-and-chat/launch-options.mjs`
- `packages/ui/src/main/features/run-common.ts`
- `packages/ui/src/main/flow/BOSS_RECOMMEND_MAIN/index.ts`
- `packages/ui/src/main/flow/BOSS_CHAT_PAGE_MAIN/index.ts`
- `packages/ui/src/main/flow/BOSS_AUTO_BROWSE_AND_CHAT_MAIN/index.ts`
- `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts`
- `packages/ui/src/renderer/src/page/MainLayout/LeftNavBar/RecruiterPart.vue`
- `packages/ui/src/renderer/src/page/MainLayout/BossJobConfig/index.vue`
- `packages/ui/src/renderer/src/page/MainLayout/BossAutoSequence/index.vue`
- `packages/ui/src/renderer/src/router/index.ts`

新增：

- `packages/ui/src/main/flow/BOSS_MULTI_ACCOUNT_SEQUENCE_MAIN/index.ts`
- `packages/ui/src/renderer/src/page/MainLayout/BossMultiAccountSequence/index.vue`

## 实施顺序

1. 增加账号文件模型、迁移和路径 helper。
2. 让配置读写 IPC 支持当前账号。
3. 左侧 pane 加账号切换和账号管理。
4. 让同步岗位、推荐牛人、沟通、自动顺序执行传入 `accountId`。
5. 新增多账号自动执行 worker 和页面。
6. 补齐导入导出的账号作用域。
7. 增加测试和人工验证。

