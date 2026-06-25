# 招聘端 LLM 后端与配置 UI 重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为招聘端建立一个自包含、按 provider-dialect × model-family 解析的 LLM 层(内置各品牌 thinking 开关、每模型采样参数、自动重试 + 多模型 failover、JSON Schema 结构化输出与降级),并把配置升级为 v2(无感迁移)+ 三标签页配置 UI。

**Architecture:** 新增 `packages/boss-auto-browse-and-chat/llm/`,两轴解析:`resolveDialect`(看 baseURL/endpoint,owns 线格式)× `resolveModelFamily`(看 model id,owns 能力)→ `resolveModelProfile` 合并。`chatComplete` 单次调用(按 `schemaMode` 构造一次,不自循环),`chatCompleteForPurpose` 用无状态 `classifyError` + 有状态 `decideNext` 驱动 retry/endpoint降级/schema降级/failover。不改 `packages/utils/gpt-request.mjs`(应聘端零回归)。

**Tech Stack:** Node ESM `.mjs`(无构建)、`openai` SDK v4、`node:test` + `node:assert/strict`(运行 `node --test <file>`)、Electron 主进程 IPC、Vue 3 `<script setup>` + Element Plus。

**Spec:** `docs/superpowers/specs/2026-06-16-recruiter-llm-redesign-design.md`(commit `d13ec0a`,codex LGTM)。

**Conventions(必须遵守):** 无分号、单引号、`printWidth:100`、无尾逗号(boss 包 `.mjs` 同样遵循)。所有新模块放 `packages/boss-auto-browse-and-chat/llm/`,测试与被测同目录、命名 `*.test.mjs`。每个 task 末尾 commit。

---

## File Structure

新增(全部在 `packages/boss-auto-browse-and-chat/llm/`):

| 文件 | 职责 |
|---|---|
| `dialects/generic.mjs` | 默认/SiliconFlow 线格式:顶层 `enable_thinking`+`thinking_budget`;Chat `response_format` |
| `dialects/qwen.mjs` | DashScope:顶层字段,thinking 时强制 stream 聚合 |
| `dialects/deepseek.mjs` | api.deepseek.com 直连:reasoner 模型名 / V4 `thinking.type` |
| `dialects/glm.mjs` | 智谱:`thinking:{type}` |
| `dialects/openai-chat.mjs` | OpenAI Chat:`reasoning_effort`+`max_completion_tokens`,`response_format` |
| `dialects/openai-responses.mjs` | OpenAI Responses:`reasoning.effort`+`max_output_tokens`,`text.format` |
| `dialects/index.mjs` | 注册表 + `resolveDialect({baseURL,brandLock,endpoint,family})` |
| `families.mjs` | `resolveModelFamily(modelId)` → 能力标志 |
| `profiles.mjs` | `resolveModelProfile({dialect,family,userOverrides})` |
| `schema-validate.mjs` | `validateAgainstSchema(content, schema)` → parsed 或抛 `invalid_output` |
| `errors.mjs` | `classifyError(err)`(无状态)+ `decideNext(kind, state)`(有状态) |
| `usage.mjs` | `normalizeUsage(raw)` |
| `chat-complete.mjs` | `chatComplete(model, messages, opts)` |
| `failover.mjs` | `chatCompleteForPurpose(config, purpose, messages, opts)` + `resolveModelChain` |

修改:
- `packages/boss-auto-browse-and-chat/package.json`(加 `openai` 依赖)
- `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs`(`readBossLlmConfig`/`writeBossLlmConfig` 升级 v2 迁移+硬化)
- `packages/boss-auto-browse-and-chat/llm-rubric.mjs`(两个函数改走新层;`getEnabledLlmClient` 标记 deprecated 保留)
- `packages/boss-auto-browse-and-chat/chat-page-processor.mjs`(`screenCandidateWithLlm` 改走新层)
- `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts`(加 `boss-detect-brand` IPC)
- `packages/ui/src/renderer/src/page/BossLlmConfig/index.vue`(三标签页重写)

不改:`packages/utils/gpt-request.mjs`、`recommend/scorer.mjs`(经 `evaluateResumeByRubric` 间接受益)。

---

## Task 0: 加 openai 依赖到 boss 包

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/package.json`

- [ ] **Step 1: 加依赖**

在 `dependencies` 中加入(版本与 utils 对齐):

```json
"openai": "^4.91.1"
```

加完后 `dependencies` 应同时含 `@geekgeekrun/utils` 和 `openai`(键按字母序插入即可,prettier 不强制 json key 顺序)。

- [ ] **Step 2: 安装**

Run: `pnpm install`
Expected: 无 `ERR_PNPM_OUTDATED_LOCKFILE`;`packages/boss-auto-browse-and-chat/node_modules/openai` 可解析(或 hoisted 到根)。若报 lockfile,改用 `CI=true pnpm install --no-frozen-lockfile`。

- [ ] **Step 3: 确认可 import**

Run: `node -e "import('openai').then(m=>console.log(typeof m.default))" ` (在 `packages/boss-auto-browse-and-chat` 目录下)
Expected: 打印 `function`。

- [ ] **Step 4: Commit**

```bash
git add packages/boss-auto-browse-and-chat/package.json pnpm-lock.yaml
git commit -m "chore(boss-llm): add openai SDK dependency for self-contained llm layer"
```

---

## Task 1: families.mjs — resolveModelFamily(无状态纯函数)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/families.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/families.test.mjs`

`resolveModelFamily(modelId)` 只看 model id 字符串,返回能力标志(spec §3.2)。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/families.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelFamily } from './families.mjs'

test('deepseek-reasoner: reasoning model, ignores sampling, json_object cap', () => {
  const f = resolveModelFamily('deepseek-reasoner')
  assert.equal(f.isReasoningModel, true)
  assert.deepEqual(f.ignoresSampling, ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'])
  assert.equal(f.structuredOutputCap, 'json_object')
})

test('siliconflow-hosted deepseek-r1 path still detected as deepseek reasoner family', () => {
  const f = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  assert.equal(f.isReasoningModel, true)
  assert.equal(f.ignoresSampling.length > 0, true)
})

test('qwq / -thinking → reasoning model', () => {
  assert.equal(resolveModelFamily('qwq-32b').isReasoningModel, true)
  assert.equal(resolveModelFamily('qwen3-235b-a22b-thinking').isReasoningModel, true)
})

test('openai gpt-5 / o-series → reasoning with effort tiers', () => {
  const g = resolveModelFamily('gpt-5')
  assert.equal(g.isReasoningModel, true)
  assert.ok(Array.isArray(g.effortValues) && g.effortValues.includes('medium'))
  assert.equal(resolveModelFamily('o3-mini').isReasoningModel, true)
})

test('plain chat model → not reasoning, full sampling, json_schema cap', () => {
  const f = resolveModelFamily('qwen-plus')
  assert.equal(f.isReasoningModel, false)
  assert.deepEqual(f.ignoresSampling, [])
  assert.equal(f.structuredOutputCap, 'json_schema')
})

test('unknown id → safe defaults (non-reasoning, json_object cap)', () => {
  const f = resolveModelFamily('some-random-model')
  assert.equal(f.isReasoningModel, false)
  assert.equal(f.structuredOutputCap, 'json_object')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/families.test.mjs`
Expected: FAIL(`Cannot find module './families.mjs'`)。

- [ ] **Step 3: Write minimal implementation**

`packages/boss-auto-browse-and-chat/llm/families.mjs`:

```js
/**
 * resolveModelFamily(modelId) — 仅看 model id,返回能力标志(无状态)。
 * 能力跟 model family(spec §3.2);线格式跟 dialect(见 dialects/)。
 */

const FULL_SAMPLING = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty']

/**
 * @param {string} modelId
 * @returns {{ isReasoningModel: boolean, ignoresSampling: string[], structuredOutputCap: 'json_schema'|'json_object'|'none', effortValues?: string[] }}
 */
export function resolveModelFamily (modelId) {
  const id = String(modelId || '').toLowerCase()

  // OpenAI reasoning(gpt-5*, o1/o3/o4 系)→ effort 档位,采样受限
  if (/(^|\/)(o\d)(-|$)/.test(id) || /(^|\/)gpt-5/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: FULL_SAMPLING,
      structuredOutputCap: 'json_schema',
      effortValues: ['low', 'medium', 'high']
    }
  }

  // DeepSeek reasoner(直连或 SiliconFlow 托管的 R1)
  if (/deepseek-?r1|deepseek-reasoner/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: FULL_SAMPLING,
      structuredOutputCap: 'json_object'
    }
  }

  // Qwen 推理(qwq / *-thinking)
  if (/qwq|-thinking(\b|$)/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: [],
      structuredOutputCap: 'json_object'
    }
  }

  // GLM thinking 系(zhipu glm-4.5/4.6,默认动态思考)
  if (/glm-4\.[56]|glm-z1/.test(id)) {
    return {
      isReasoningModel: true,
      ignoresSampling: [],
      structuredOutputCap: 'json_object'
    }
  }

  // 普通 chat 模型:已知品牌前缀给 json_schema,其余保守 json_object
  if (/qwen|glm|deepseek|gpt-4|gpt-3|moonshot|kimi/.test(id)) {
    return {
      isReasoningModel: false,
      ignoresSampling: [],
      structuredOutputCap: 'json_schema'
    }
  }

  return {
    isReasoningModel: false,
    ignoresSampling: [],
    structuredOutputCap: 'json_object'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/families.test.mjs`
Expected: PASS(6 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/families.mjs packages/boss-auto-browse-and-chat/llm/families.test.mjs
git commit -m "feat(boss-llm): resolveModelFamily — model-id capability resolution"
```

---

## Task 2: dialects/* + resolveDialect

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/dialects/generic.mjs`, `qwen.mjs`, `deepseek.mjs`, `glm.mjs`, `openai-chat.mjs`, `openai-responses.mjs`, `index.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/dialects/index.test.mjs`, `packages/boss-auto-browse-and-chat/llm/dialects/build-request.test.mjs`

每个 dialect 是纯对象:`{ id, label, endpoint, thinkingStyle, tokenLimitField, requiresStreamForThinking, match({baseURL,endpoint}), buildStructuredOutput({schema,schemaMode,family}), buildRequest({family,thinking,sampling,schema,schemaMode,messages,tokenLimit}), parseResponse(raw) }`(spec §3.2)。`buildRequest` 只按传入 `schemaMode` 构造一次,不自循环降级。

- [ ] **Step 1: Write the failing test (resolveDialect)**

`packages/boss-auto-browse-and-chat/llm/dialects/index.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDialect } from './index.mjs'
import { resolveModelFamily } from '../families.mjs'

test('siliconflow baseURL → generic dialect even for deepseek model', () => {
  const family = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  const d = resolveDialect({ baseURL: 'https://api.siliconflow.cn/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'generic')
})

test('api.deepseek.com → deepseek dialect', () => {
  const family = resolveModelFamily('deepseek-reasoner')
  const d = resolveDialect({ baseURL: 'https://api.deepseek.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'deepseek')
})

test('dashscope → qwen dialect, requiresStreamForThinking', () => {
  const family = resolveModelFamily('qwq-32b')
  const d = resolveDialect({ baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'qwen')
  assert.equal(d.requiresStreamForThinking, true)
})

test('openai auto + reasoning model → openai-responses', () => {
  const family = resolveModelFamily('gpt-5')
  const d = resolveDialect({ baseURL: 'https://api.openai.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'openai-responses')
})

test('openai endpoint locked to chat → openai-chat', () => {
  const family = resolveModelFamily('gpt-5')
  const d = resolveDialect({ baseURL: 'https://api.openai.com/v1', brandLock: 'openai', endpoint: 'chat', family })
  assert.equal(d.id, 'openai-chat')
})

test('brandLock overrides baseURL detection', () => {
  const family = resolveModelFamily('glm-4.6')
  const d = resolveDialect({ baseURL: 'https://unknown.example.com/v1', brandLock: 'glm', endpoint: 'auto', family })
  assert.equal(d.id, 'glm')
})

test('unknown baseURL, auto → generic', () => {
  const family = resolveModelFamily('whatever')
  const d = resolveDialect({ baseURL: 'https://x.example.com/v1', brandLock: 'auto', endpoint: 'auto', family })
  assert.equal(d.id, 'generic')
})
```

- [ ] **Step 2: Write the failing test (buildRequest wire formats)**

`packages/boss-auto-browse-and-chat/llm/dialects/build-request.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import generic from './generic.mjs'
import qwen from './qwen.mjs'
import deepseek from './deepseek.mjs'
import glm from './glm.mjs'
import openaiChat from './openai-chat.mjs'
import openaiResponses from './openai-responses.mjs'
import { resolveModelFamily } from '../families.mjs'

const msgs = [{ role: 'user', content: 'hi' }]

test('generic: top-level enable_thinking + thinking_budget + max_tokens', () => {
  const f = resolveModelFamily('Pro/deepseek-ai/DeepSeek-R1')
  const req = generic.buildRequest({ family: f, thinking: { enabled: true, budget: 2048 }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'Pro/deepseek-ai/DeepSeek-R1' })
  assert.equal(req.enable_thinking, true)
  assert.equal(req.thinking_budget, 2048)
  assert.equal(req.max_tokens, 500)
})

test('qwen: top-level enable_thinking (not extra_body), stream when thinking', () => {
  const f = resolveModelFamily('qwq-32b')
  const req = qwen.buildRequest({ family: f, thinking: { enabled: true, budget: 1024 }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 800, model: 'qwq-32b' })
  assert.equal(req.enable_thinking, true)
  assert.equal(req.thinking_budget, 1024)
  assert.equal(req.stream, true)
  assert.ok(req.stream_options && req.stream_options.include_usage === true)
})

test('deepseek V4: thinking.type only, never reasoning_effort', () => {
  const f = resolveModelFamily('deepseek-chat')
  const req = deepseek.buildRequest({ family: f, thinking: { enabled: true }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'deepseek-chat' })
  assert.equal(req.thinking && req.thinking.type, 'enabled')
  assert.equal('reasoning_effort' in req, false)
})

test('deepseek reasoner: model name drives thinking, strips sampling', () => {
  const f = resolveModelFamily('deepseek-reasoner')
  const req = deepseek.buildRequest({ family: f, thinking: { enabled: true }, sampling: { temperature: 0.9 }, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'deepseek-reasoner' })
  assert.equal('temperature' in req, false)
})

test('glm: thinking.type string enabled/disabled, no budget', () => {
  const f = resolveModelFamily('glm-4.6')
  const on = glm.buildRequest({ family: f, thinking: { enabled: true }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'glm-4.6' })
  assert.equal(on.thinking.type, 'enabled')
  const off = glm.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 500, model: 'glm-4.6' })
  assert.equal(off.thinking.type, 'disabled')
  assert.equal('thinking_budget' in on, false)
})

test('openai-chat: reasoning_effort + max_completion_tokens, no max_tokens, strips sampling', () => {
  const f = resolveModelFamily('gpt-5')
  const req = openaiChat.buildRequest({ family: f, thinking: { enabled: true, effort: 'medium' }, sampling: { temperature: 0.5 }, schema: null, schemaMode: 'none', messages: msgs, tokenLimit: 600, model: 'gpt-5' })
  assert.equal(req.reasoning_effort, 'medium')
  assert.equal(req.max_completion_tokens, 600)
  assert.equal('max_tokens' in req, false)
  assert.equal('temperature' in req, false)
})

test('openai-responses: reasoning.effort + max_output_tokens + text.format', () => {
  const f = resolveModelFamily('gpt-5')
  const schema = { name: 'r', schema: { type: 'object' } }
  const req = openaiResponses.buildRequest({ family: f, thinking: { enabled: true, effort: 'high' }, sampling: {}, schema, schemaMode: 'json_schema', messages: msgs, tokenLimit: 700, model: 'gpt-5' })
  assert.equal(req.reasoning.effort, 'high')
  assert.equal(req.max_output_tokens, 700)
  assert.ok(req.text && req.text.format)
})

test('schemaMode downgrade: json_object then prompt-only (generic)', () => {
  const f = resolveModelFamily('qwen-plus')
  const j = generic.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: { name: 'x', schema: {} }, schemaMode: 'json_object', messages: msgs, tokenLimit: 500, model: 'qwen-plus' })
  assert.deepEqual(j.response_format, { type: 'json_object' })
  const p = generic.buildRequest({ family: f, thinking: { enabled: false }, sampling: {}, schema: { name: 'x', schema: {} }, schemaMode: 'prompt-only', messages: msgs, tokenLimit: 500, model: 'qwen-plus' })
  assert.equal('response_format' in p, false)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test packages/boss-auto-browse-and-chat/llm/dialects/`
Expected: FAIL(模块不存在)。

- [ ] **Step 4: Implement dialects — generic.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/generic.mjs`:

```js
/**
 * generic dialect — OpenAI 兼容代理(SiliconFlow / 火山 Ark 等)。
 * thinking:顶层 enable_thinking + thinking_budget;token:max_tokens;结构化:Chat response_format。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

function applyStructured (req, schema, schemaMode) {
  if (schemaMode === 'json_schema') {
    req.response_format = { type: 'json_schema', json_schema: schema }
  } else if (schemaMode === 'json_object') {
    req.response_format = { type: 'json_object' }
  }
  // prompt-only / none：不带结构化字段
}

export default {
  id: 'generic',
  label: '通用兼容 / SiliconFlow',
  endpoint: 'chat',
  thinkingStyle: 'top_level_enable',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /siliconflow|ark\.cn-|volces\.com|localhost|127\.0\.0\.1/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: schema } }
    if (schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    if (thinking?.enabled && typeof thinking.budget === 'number') {
      req.enable_thinking = true
      req.thinking_budget = thinking.budget
    }
    applyStructured(req, schema, schemaMode)
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
```

- [ ] **Step 5: Implement dialects — qwen.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/qwen.mjs`:

```js
/**
 * qwen dialect — DashScope 兼容模式。Node openai SDK 用顶层字段(extra_body 是 Python 写法)。
 * thinking 时必须 stream;由 chat-complete.mjs 内部聚合 reasoning_content + content。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'qwen',
  label: '通义千问 Qwen / DashScope',
  endpoint: 'chat',
  thinkingStyle: 'qwen_enable',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: true,
  match ({ baseURL }) {
    return /dashscope\.aliyuncs\.com|aliyuncs/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: schema } }
    if (schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    if (thinking?.enabled) {
      req.enable_thinking = true
      if (typeof thinking.budget === 'number') req.thinking_budget = thinking.budget
      req.stream = true
      req.stream_options = { include_usage: true }
    }
    if (schemaMode === 'json_schema') req.response_format = { type: 'json_schema', json_schema: schema }
    else if (schemaMode === 'json_object') req.response_format = { type: 'json_object' }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
```

- [ ] **Step 6: Implement dialects — deepseek.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/deepseek.mjs`:

```js
/**
 * deepseek dialect — api.deepseek.com 直连。
 * reasoner:模型名=开,忽略采样;V4(deepseek-chat):thinking:{type} only(不发 reasoning_effort,spec §3.4)。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'deepseek',
  label: 'DeepSeek 直连',
  endpoint: 'chat',
  thinkingStyle: 'model_name',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /api\.deepseek\.com/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    // reasoner 支持 JSON 输出,不支持 json_schema 严格模式 → 用 json_object
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    const isReasonerByName = /reasoner|r1/i.test(String(model))
    if (thinking?.enabled && !isReasonerByName) {
      // V4 系:thinking.type;绝不发 reasoning_effort
      req.thinking = { type: 'enabled' }
    } else if (!thinking?.enabled && !isReasonerByName) {
      req.thinking = { type: 'disabled' }
    }
    // reasoner:由模型名决定,不加字段
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') {
      req.response_format = { type: 'json_object' }
    }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    // 注意:reasoning_content 不能回传进 input(spec §3.4),此处仅读不回写
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
```

- [ ] **Step 7: Implement dialects — glm.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/glm.mjs`:

```js
/**
 * glm dialect — 智谱 bigmodel。thinking:{ type:'enabled'|'disabled' }(字符串,非 bool,无 budget)。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'glm',
  label: '智谱 GLM',
  endpoint: 'chat',
  thinkingStyle: 'thinking_type',
  tokenLimitField: 'max_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /bigmodel\.cn|open\.bigmodel/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    req.thinking = { type: thinking?.enabled ? 'enabled' : 'disabled' }
    if (schemaMode === 'json_schema' || schemaMode === 'json_object') {
      req.response_format = { type: 'json_object' }
    }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
```

- [ ] **Step 8: Implement dialects — openai-chat.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/openai-chat.mjs`:

```js
/**
 * openai-chat dialect — OpenAI Chat Completions 兼容。
 * reasoning_effort + max_completion_tokens(不用 max_tokens);推理模型限制采样;结构化用 response_format。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

export default {
  id: 'openai-chat',
  label: 'OpenAI (Chat)',
  endpoint: 'chat',
  thinkingStyle: 'reasoning_effort',
  tokenLimitField: 'max_completion_tokens',
  requiresStreamForThinking: false,
  match ({ baseURL }) {
    return /api\.openai\.com/i.test(String(baseURL || ''))
  },
  buildStructuredOutput ({ schema, schemaMode }) {
    if (schemaMode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: schema } }
    if (schemaMode === 'json_object') return { response_format: { type: 'json_object' } }
    return {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, messages }
    if (typeof tokenLimit === 'number') req.max_completion_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    if (thinking?.enabled && thinking.effort) req.reasoning_effort = thinking.effort
    if (schemaMode === 'json_schema') req.response_format = { type: 'json_schema', json_schema: schema }
    else if (schemaMode === 'json_object') req.response_format = { type: 'json_object' }
    return req
  },
  parseResponse (raw) {
    const msg = raw?.choices?.[0]?.message ?? {}
    return { content: msg.content ?? '', reasoning: msg.reasoning_content ?? null, raw }
  }
}
```

- [ ] **Step 9: Implement dialects — openai-responses.mjs**

`packages/boss-auto-browse-and-chat/llm/dialects/openai-responses.mjs`:

```js
/**
 * openai-responses dialect — OpenAI Responses API。
 * reasoning.effort + max_output_tokens;结构化用 text.format。
 * 注意:Responses API 的 input 与 messages 形态不同 —— buildRequest 产出后,
 * chat-complete.mjs 走 openai.responses.create(见 Task 7)。
 */

function applySampling (req, sampling, ignore) {
  for (const [k, v] of Object.entries(sampling || {})) {
    if (v === null || v === undefined) continue
    if (ignore.includes(k)) continue
    req[k] = v
  }
}

function buildTextFormat (schema, schemaMode) {
  if (schemaMode === 'json_schema') {
    return { format: { type: 'json_schema', name: schema.name || 'result', schema: schema.schema || schema } }
  }
  if (schemaMode === 'json_object') {
    return { format: { type: 'json_object' } }
  }
  return null
}

export default {
  id: 'openai-responses',
  label: 'OpenAI (Responses)',
  endpoint: 'responses',
  thinkingStyle: 'reasoning_effort',
  tokenLimitField: 'max_output_tokens',
  requiresStreamForThinking: false,
  match () { return false }, // 由 index.mjs 显式选择,不靠 match
  buildStructuredOutput ({ schema, schemaMode }) {
    const t = buildTextFormat(schema, schemaMode)
    return t ? { text: t } : {}
  },
  buildRequest ({ family, thinking, sampling, schema, schemaMode, messages, tokenLimit, model }) {
    const req = { model, input: messages }
    if (typeof tokenLimit === 'number') req.max_output_tokens = tokenLimit
    applySampling(req, sampling, family.ignoresSampling)
    if (thinking?.enabled && thinking.effort) req.reasoning = { effort: thinking.effort }
    const t = buildTextFormat(schema, schemaMode)
    if (t) req.text = t
    return req
  },
  parseResponse (raw) {
    // Responses API:output_text 便捷字段;否则遍历 output
    const content = raw?.output_text
      ?? (Array.isArray(raw?.output)
        ? raw.output.flatMap((o) => (o.content || []).map((c) => c.text || '')).join('')
        : '')
    return { content: content ?? '', reasoning: null, raw }
  }
}
```

- [ ] **Step 10: Implement dialects/index.mjs (resolveDialect)**

`packages/boss-auto-browse-and-chat/llm/dialects/index.mjs`:

```js
import generic from './generic.mjs'
import qwen from './qwen.mjs'
import deepseek from './deepseek.mjs'
import glm from './glm.mjs'
import openaiChat from './openai-chat.mjs'
import openaiResponses from './openai-responses.mjs'

// 注册表:brandLock 值 → dialect(openai 特殊,见下)
const BY_BRAND = {
  generic,
  qwen,
  deepseek,
  glm
  // openai 由 endpoint 解析,不在此直查
}

// 自动识别顺序(看 baseURL):先具体后通用,generic 兜底
const AUTO_MATCH = [qwen, deepseek, glm, openaiChat]

function pickOpenAi ({ endpoint, family }) {
  if (endpoint === 'chat') return openaiChat
  if (endpoint === 'responses') return openaiResponses
  // auto:推理模型优先 Responses,否则 Chat
  return family?.isReasoningModel ? openaiResponses : openaiChat
}

/**
 * resolveDialect({ baseURL, brandLock, endpoint, family }) -> dialect 对象。
 * brandLock!=='auto' 只锁 dialect/provider;model family 仍由 resolveModelFamily 决定(正交)。
 */
export function resolveDialect ({ baseURL, brandLock, endpoint, family }) {
  if (brandLock && brandLock !== 'auto') {
    if (brandLock === 'openai') return pickOpenAi({ endpoint, family })
    if (BY_BRAND[brandLock]) return BY_BRAND[brandLock]
    return generic
  }
  // auto:OpenAI 域名 → openai 组
  if (/api\.openai\.com/i.test(String(baseURL || ''))) return pickOpenAi({ endpoint, family })
  for (const d of AUTO_MATCH) {
    if (d.match({ baseURL, endpoint })) return d
  }
  return generic
}

export { generic, qwen, deepseek, glm, openaiChat, openaiResponses }
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `node --test packages/boss-auto-browse-and-chat/llm/dialects/`
Expected: PASS(index.test.mjs 7 + build-request.test.mjs 8)。

- [ ] **Step 12: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/dialects/
git commit -m "feat(boss-llm): provider dialects + resolveDialect (wire-format per endpoint)"
```

---

## Task 3: profiles.mjs — resolveModelProfile

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/profiles.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/profiles.test.mjs`

合并 dialect + family + 用户覆盖 → ModelProfile(spec §3.3)。`structuredOutput = min(dialect 能力, family.structuredOutputCap)`、`unsupportedSampling = family.ignoresSampling`、`effortValues = family.effortValues`。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/profiles.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelProfile } from './profiles.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelFamily } from './families.mjs'

function profileFor (baseURL, modelId, brandLock = 'auto', endpoint = 'auto') {
  const family = resolveModelFamily(modelId)
  const dialect = resolveDialect({ baseURL, brandLock, endpoint, family })
  return resolveModelProfile({ dialect, family, userOverrides: {} })
}

test('siliconflow deepseek-r1: generic dialect + reasoner family', () => {
  const p = profileFor('https://api.siliconflow.cn/v1', 'Pro/deepseek-ai/DeepSeek-R1')
  assert.equal(p.dialectId, 'generic')
  assert.equal(p.thinkingStyle, 'top_level_enable')
  assert.equal(p.tokenLimitField, 'max_tokens')
  assert.ok(p.unsupportedSampling.includes('temperature'))
})

test('structuredOutput = min(dialect cap, family cap): deepseek family caps json_object', () => {
  const p = profileFor('https://api.openai.com/v1', 'gpt-4o')
  assert.equal(p.structuredOutput, 'json_schema')
  const p2 = profileFor('https://api.siliconflow.cn/v1', 'deepseek-reasoner')
  assert.equal(p2.structuredOutput, 'json_object')
})

test('openai gpt-5 auto → responses endpoint + effortValues', () => {
  const p = profileFor('https://api.openai.com/v1', 'gpt-5')
  assert.equal(p.dialectId, 'openai-responses')
  assert.equal(p.endpoint, 'responses')
  assert.deepEqual(p.effortValues, ['low', 'medium', 'high'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/profiles.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/profiles.mjs`:

```js
const SO_RANK = { none: 0, json_object: 1, json_schema: 2 }
const SO_BY_RANK = ['none', 'json_object', 'json_schema']

function dialectStructuredCap (dialect) {
  // generic/qwen/openai 支持 json_schema;deepseek/glm 封顶 json_object
  if (dialect.id === 'deepseek' || dialect.id === 'glm') return 'json_object'
  return 'json_schema'
}

function minSo (a, b) {
  return SO_BY_RANK[Math.min(SO_RANK[a] ?? 0, SO_RANK[b] ?? 0)]
}

/**
 * resolveModelProfile({ dialect, family, userOverrides }) -> ModelProfile(spec §3.3)。
 */
export function resolveModelProfile ({ dialect, family, userOverrides = {} }) {
  return {
    dialectId: dialect.id,
    endpoint: dialect.endpoint,
    thinkingStyle: dialect.thinkingStyle,
    tokenLimitField: dialect.tokenLimitField,
    unsupportedSampling: [...(family.ignoresSampling || [])],
    structuredOutput: minSo(dialectStructuredCap(dialect), family.structuredOutputCap),
    requiresStreamForThinking: !!dialect.requiresStreamForThinking,
    effortValues: family.effortValues,
    ...userOverrides
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/profiles.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/profiles.mjs packages/boss-auto-browse-and-chat/llm/profiles.test.mjs
git commit -m "feat(boss-llm): resolveModelProfile — merge dialect + family + overrides"
```

---

## Task 4: errors.mjs — classifyError(无状态) + decideNext(有状态)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/errors.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/errors.test.mjs`

`classifyError(err)` → `{ kind, retryAfterMs? }`,只看错误本身(含本地抛的校验错误)。`decideNext(kind, state)` → action(spec §3.6 表)。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/errors.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyError, decideNext, LlmError } from './errors.mjs'

test('classifyError: 429 → rate_limit, honors Retry-After', () => {
  const err = Object.assign(new Error('rate'), { status: 429, headers: { 'retry-after': '3' } })
  const c = classifyError(err)
  assert.equal(c.kind, 'rate_limit')
  assert.equal(c.retryAfterMs, 3000)
})

test('classifyError: 401 → auth', () => {
  assert.equal(classifyError(Object.assign(new Error(), { status: 401 })).kind, 'auth')
})

test('classifyError: 429 insufficient_balance → quota', () => {
  const err = Object.assign(new Error('insufficient_balance'), { status: 429, error: { code: 'insufficient_balance' } })
  assert.equal(classifyError(err).kind, 'quota')
})

test('classifyError: 5xx → server, ECONNRESET → network', () => {
  assert.equal(classifyError(Object.assign(new Error(), { status: 503 })).kind, 'server')
  assert.equal(classifyError(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).kind, 'network')
})

test('classifyError: 404 responses route → endpoint_unavailable', () => {
  const err = Object.assign(new Error('not found'), { status: 404 })
  assert.equal(classifyError(err).kind, 'endpoint_unavailable')
})

test('classifyError: local LlmError invalid_output passthrough', () => {
  assert.equal(classifyError(new LlmError('invalid_output', 'bad json')).kind, 'invalid_output')
})

test('decideNext: rate_limit under limit → retry_same, at limit → next_model', () => {
  assert.equal(decideNext('rate_limit', { retrySameCount: 0, maxAttemptsPerModel: 2 }), 'retry_same')
  assert.equal(decideNext('rate_limit', { retrySameCount: 2, maxAttemptsPerModel: 2 }), 'next_model')
})

test('decideNext: endpoint_unavailable only downgrades on auto+responses', () => {
  assert.equal(decideNext('endpoint_unavailable', { configuredEndpoint: 'auto', currentEndpoint: 'responses' }), 'endpoint_downgrade')
  assert.equal(decideNext('endpoint_unavailable', { configuredEndpoint: 'chat', currentEndpoint: 'chat' }), 'next_model')
})

test('decideNext: unsupported_schema/invalid_output downgrade until prompt-only', () => {
  assert.equal(decideNext('unsupported_schema', { schemaMode: 'json_schema' }), 'schema_downgrade')
  assert.equal(decideNext('invalid_output', { schemaMode: 'json_object' }), 'schema_downgrade')
  assert.equal(decideNext('invalid_output', { schemaMode: 'prompt-only' }), 'next_model')
})

test('decideNext: auth/quota/unknown → next_model', () => {
  for (const k of ['auth', 'quota', 'unsupported_param', 'context_overflow', 'bad_request', 'unknown']) {
    assert.equal(decideNext(k, {}), 'next_model')
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/errors.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/errors.mjs`:

```js
/**
 * 错误分类(无状态)+ 决策(有状态)。spec §3.6。
 */

export class LlmError extends Error {
  constructor (kind, message) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

function readHeader (headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] ?? headers[name.toLowerCase()]
}

function bodyText (err) {
  return JSON.stringify(err?.error ?? err?.response?.data ?? {}) + ' ' + String(err?.message ?? '')
}

/**
 * classifyError(err) -> { kind, retryAfterMs? }。只看错误本身。
 */
export function classifyError (err) {
  if (err instanceof LlmError) return { kind: err.kind }

  const status = err?.status ?? err?.statusCode ?? err?.response?.status
  const code = err?.code ?? err?.error?.code
  const text = bodyText(err).toLowerCase()

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || /network|socket|fetch failed/.test(text)) {
    return { kind: 'network' }
  }
  if (status === 429) {
    const ra = readHeader(err?.headers, 'retry-after')
    const retryAfterMs = ra ? Number(ra) * 1000 : undefined
    if (/insufficient|quota|balance|exceeded your current quota/.test(text)) return { kind: 'quota', retryAfterMs }
    return { kind: 'rate_limit', retryAfterMs }
  }
  if (status === 401 || status === 403) return { kind: 'auth' }
  if (status === 404) return { kind: 'endpoint_unavailable' }
  if (status === 400) {
    if (/response_format|json_schema|text\.format|schema|tool|function/.test(text)) return { kind: 'unsupported_schema' }
    if (/maximum context|context length|too long|reduce the length/.test(text)) return { kind: 'context_overflow' }
    if (/temperature|top_p|unsupported parameter|unknown parameter|reasoning_effort/.test(text)) return { kind: 'unsupported_param' }
    return { kind: 'bad_request' }
  }
  if (typeof status === 'number' && status >= 500) return { kind: 'server' }
  return { kind: 'unknown' }
}

const NEXT_KINDS = new Set(['auth', 'quota', 'unsupported_param', 'context_overflow', 'bad_request', 'unknown'])
const RETRY_KINDS = new Set(['rate_limit', 'server', 'network', 'stream_timeout'])

/**
 * decideNext(kind, state) -> action。state 注入 maxAttemptsPerModel 使其自洽可测。
 */
export function decideNext (kind, state = {}) {
  if (RETRY_KINDS.has(kind)) {
    const { retrySameCount = 0, maxAttemptsPerModel = 2 } = state
    return retrySameCount < maxAttemptsPerModel ? 'retry_same' : 'next_model'
  }
  if (kind === 'endpoint_unavailable') {
    return state.configuredEndpoint === 'auto' && state.currentEndpoint === 'responses'
      ? 'endpoint_downgrade'
      : 'next_model'
  }
  if (kind === 'unsupported_schema' || kind === 'invalid_output') {
    return state.schemaMode && state.schemaMode !== 'prompt-only' ? 'schema_downgrade' : 'next_model'
  }
  if (NEXT_KINDS.has(kind)) return 'next_model'
  return 'next_model'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/errors.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/errors.mjs packages/boss-auto-browse-and-chat/llm/errors.test.mjs
git commit -m "feat(boss-llm): stateless classifyError + stateful decideNext"
```

---

## Task 5: schema-validate.mjs(validate-only)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/schema-validate.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/schema-validate.test.mjs`

仅 `JSON.parse` + 轻量形状校验,通过返回 parsed,失败抛 `LlmError('invalid_output')`。不做降级(降级在 failover)。轻量校验:校验顶层 `required` 键存在(避免引入 ajv 依赖,YAGNI)。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/schema-validate.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAgainstSchema } from './schema-validate.mjs'
import { LlmError } from './errors.mjs'

const schema = { name: 'r', schema: { type: 'object', required: ['pass', 'reason'] } }

test('valid json with required keys → parsed', () => {
  const r = validateAgainstSchema('{"pass":true,"reason":"ok"}', schema)
  assert.deepEqual(r, { pass: true, reason: 'ok' })
})

test('extracts json from surrounding text', () => {
  const r = validateAgainstSchema('好的\n{"pass":false,"reason":"x"}\n以上', schema)
  assert.equal(r.pass, false)
})

test('non-json → throws invalid_output', () => {
  assert.throws(() => validateAgainstSchema('not json at all', schema), (e) => e instanceof LlmError && e.kind === 'invalid_output')
})

test('missing required key → throws invalid_output', () => {
  assert.throws(() => validateAgainstSchema('{"pass":true}', schema), (e) => e.kind === 'invalid_output')
})

test('no schema → parse only, returns parsed', () => {
  assert.deepEqual(validateAgainstSchema('{"a":1}', null), { a: 1 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/schema-validate.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/schema-validate.mjs`:

```js
import { LlmError } from './errors.mjs'

function extractJson (content) {
  const s = String(content ?? '').trim()
  // 去 markdown code fence
  const noFence = s.replace(/```(?:json)?/gi, '')
  const m = noFence.match(/\{[\s\S]*\}/)
  return m ? m[0] : noFence
}

/**
 * validateAgainstSchema(content, schema) -> parsed,失败抛 LlmError('invalid_output')。
 * 轻量:JSON.parse + 顶层 required 键存在性(不引入 ajv)。
 */
export function validateAgainstSchema (content, schema) {
  let parsed
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    throw new LlmError('invalid_output', 'response is not valid JSON')
  }
  const required = schema?.schema?.required
  if (Array.isArray(required)) {
    for (const key of required) {
      if (!(key in (parsed ?? {}))) {
        throw new LlmError('invalid_output', `missing required key: ${key}`)
      }
    }
  }
  return parsed
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/schema-validate.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/schema-validate.mjs packages/boss-auto-browse-and-chat/llm/schema-validate.test.mjs
git commit -m "feat(boss-llm): schema-validate (parse + required-key check, validate-only)"
```

---

## Task 6: usage.mjs — normalizeUsage

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/usage.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/usage.test.mjs`

归一化 usage:prompt/completion/reasoning/cached/total,兼容 Chat(`usage.*`)与 Responses(`usage.input_tokens/output_tokens`)。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/usage.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUsage } from './usage.mjs'

test('chat usage with reasoning + cached', () => {
  const u = normalizeUsage({
    prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
    completion_tokens_details: { reasoning_tokens: 20 },
    prompt_tokens_details: { cached_tokens: 30 }
  })
  assert.deepEqual(u, { prompt: 100, completion: 50, reasoning: 20, cached: 30, total: 150 })
})

test('responses usage shape', () => {
  const u = normalizeUsage({ input_tokens: 80, output_tokens: 40, total_tokens: 120, output_tokens_details: { reasoning_tokens: 10 } })
  assert.equal(u.prompt, 80)
  assert.equal(u.completion, 40)
  assert.equal(u.reasoning, 10)
})

test('missing usage → all zero', () => {
  assert.deepEqual(normalizeUsage(null), { prompt: 0, completion: 0, reasoning: 0, cached: 0, total: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/usage.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/usage.mjs`:

```js
/**
 * normalizeUsage(raw) -> { prompt, completion, reasoning, cached, total }。
 * 兼容 Chat Completions 与 Responses API 的 usage 形态。
 */
export function normalizeUsage (u) {
  if (!u || typeof u !== 'object') {
    return { prompt: 0, completion: 0, reasoning: 0, cached: 0, total: 0 }
  }
  const prompt = u.prompt_tokens ?? u.input_tokens ?? 0
  const completion = u.completion_tokens ?? u.output_tokens ?? 0
  const reasoning = u.completion_tokens_details?.reasoning_tokens
    ?? u.output_tokens_details?.reasoning_tokens
    ?? 0
  const cached = u.prompt_tokens_details?.cached_tokens
    ?? u.input_tokens_details?.cached_tokens
    ?? 0
  const total = u.total_tokens ?? (prompt + completion)
  return { prompt, completion, reasoning, cached, total }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/usage.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/usage.mjs packages/boss-auto-browse-and-chat/llm/usage.test.mjs
git commit -m "feat(boss-llm): normalizeUsage (chat + responses shapes)"
```

---

## Task 7: chat-complete.mjs — chatComplete(单次调用)

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/chat-complete.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/chat-complete.test.mjs`

`chatComplete(model, messages, { schema, sampling, maxOutputTokens, schemaMode, signal })`。为可测,SDK 客户端通过 `opts._clientFactory`(默认创建真实 openai client)注入。流程见 spec §3.5。

- [ ] **Step 1: Write the failing test (inject fake client)**

`packages/boss-auto-browse-and-chat/llm/chat-complete.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatComplete } from './chat-complete.mjs'

function fakeClientFactory (captured) {
  return () => ({
    chat: {
      completions: {
        create: async (req) => {
          captured.req = req
          return {
            choices: [{ message: { content: '{"pass":true,"reason":"ok"}', reasoning_content: 'because' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }
        }
      }
    },
    responses: { create: async () => ({ output_text: '{"pass":true,"reason":"r"}', usage: { input_tokens: 1, output_tokens: 1 } }) }
  })
}

const model = {
  baseURL: 'https://api.siliconflow.cn/v1', apiKey: 'sk-x', model: 'Pro/deepseek-ai/DeepSeek-R1',
  brand: 'auto', endpoint: 'auto', thinking: { enabled: true, budget: 2048 }, sampling: { temperature: null }
}

test('builds generic request, returns normalized result with parsed + usage', async () => {
  const captured = {}
  const schema = { name: 'r', schema: { type: 'object', required: ['pass', 'reason'] } }
  const r = await chatComplete(model, [{ role: 'user', content: 'hi' }], {
    schema, schemaMode: 'json_object', maxOutputTokens: 500, _clientFactory: fakeClientFactory(captured)
  })
  assert.equal(captured.req.enable_thinking, true)
  assert.equal(captured.req.max_tokens, 500)
  assert.deepEqual(r.parsed, { pass: true, reason: 'ok' })
  assert.equal(r.usage.prompt, 10)
  assert.equal(r.reasoning, 'because')
  assert.ok(r.raw)
})

test('user sampling.max_tokens overrides maxOutputTokens', async () => {
  const captured = {}
  await chatComplete(
    { ...model, thinking: { enabled: false }, sampling: { max_tokens: 999 } },
    [{ role: 'user', content: 'hi' }],
    { schemaMode: 'none', maxOutputTokens: 500, _clientFactory: fakeClientFactory(captured) }
  )
  assert.equal(captured.req.max_tokens, 999)
})

test('invalid json throws LlmError invalid_output', async () => {
  const factory = () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: 'nope' } }], usage: {} }) } } })
  const schema = { name: 'r', schema: { type: 'object', required: ['pass'] } }
  await assert.rejects(
    chatComplete(model, [{ role: 'user', content: 'hi' }], { schema, schemaMode: 'json_object', _clientFactory: factory }),
    (e) => e.kind === 'invalid_output'
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/chat-complete.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/chat-complete.mjs`:

```js
import OpenAI from 'openai'
import { resolveModelFamily } from './families.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelProfile } from './profiles.mjs'
import { validateAgainstSchema } from './schema-validate.mjs'
import { normalizeUsage } from './usage.mjs'

const DEFAULT_TIMEOUT_MS = 60000

function defaultClientFactory (model) {
  return new OpenAI({ baseURL: model.baseURL, apiKey: model.apiKey })
}

function initSchemaMode (schema, profile) {
  if (!schema) return 'none'
  if (profile.structuredOutput === 'none') return 'prompt-only'
  return profile.structuredOutput // json_schema | json_object
}

function mergeSampling (model, optsSampling) {
  return { ...(model.sampling || {}), ...(optsSampling || {}) }
}

function injectSchemaPrompt (messages, schema) {
  // prompt-only 模式:把 schema 描述追加进 system / 末条
  const hint = `\n\n请严格输出符合该 JSON Schema 的 JSON,不要任何多余文字:\n${JSON.stringify(schema?.schema ?? schema)}`
  const copy = messages.map((m) => ({ ...m }))
  const sys = copy.find((m) => m.role === 'system')
  if (sys) sys.content += hint
  else copy.unshift({ role: 'system', content: hint.trim() })
  return copy
}

async function aggregateStream (stream) {
  let content = ''
  let reasoning = ''
  let usage = null
  for await (const chunk of stream) {
    const delta = chunk?.choices?.[0]?.delta ?? {}
    if (delta.content) content += delta.content
    if (delta.reasoning_content) reasoning += delta.reasoning_content
    if (chunk?.usage) usage = chunk.usage
  }
  return { choices: [{ message: { content, reasoning_content: reasoning || null } }], usage }
}

/**
 * chatComplete(model, messages, opts) — 单次调用,按 opts.schemaMode 构造一次(不自循环降级)。
 * opts: { schema, sampling, maxOutputTokens, schemaMode, signal, _clientFactory }
 */
export async function chatComplete (model, messages, opts = {}) {
  const family = resolveModelFamily(model.model)
  const dialect = resolveDialect({
    baseURL: model.baseURL, brandLock: model.brand, endpoint: model.endpoint, family
  })
  const profile = resolveModelProfile({ dialect, family, userOverrides: {} })

  const schema = opts.schema ?? null
  const schemaMode = opts.schemaMode ?? initSchemaMode(schema, profile)

  const sampling = mergeSampling(model, opts.sampling)
  const tokenLimit = typeof sampling.max_tokens === 'number' ? sampling.max_tokens : opts.maxOutputTokens
  // max_tokens 已并入 tokenLimit,避免 buildRequest 重复写采样
  const samplingForBuild = { ...sampling }
  delete samplingForBuild.max_tokens

  let outMessages = messages
  if (schemaMode === 'prompt-only' && schema) outMessages = injectSchemaPrompt(messages, schema)

  const req = dialect.buildRequest({
    family, thinking: model.thinking || {}, sampling: samplingForBuild,
    schema, schemaMode, messages: outMessages, tokenLimit, model: model.model
  })

  const client = (opts._clientFactory ? opts._clientFactory(model) : defaultClientFactory(model))
  const signal = opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let raw
  if (profile.endpoint === 'responses') {
    raw = await client.responses.create(req, { signal })
  } else if (req.stream) {
    const stream = await client.chat.completions.create(req, { signal })
    raw = await aggregateStream(stream)
  } else {
    raw = await client.chat.completions.create(req, { signal })
  }

  const { content, reasoning } = dialect.parseResponse(raw)
  const usage = normalizeUsage(raw?.usage)

  let parsed
  if (schema) parsed = validateAgainstSchema(content, schema) // 失败抛 invalid_output

  // raw 仅进程内,不外传
  return { content, parsed, reasoning, usage, raw }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/chat-complete.test.mjs`
Expected: PASS(3 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/chat-complete.mjs packages/boss-auto-browse-and-chat/llm/chat-complete.test.mjs
git commit -m "feat(boss-llm): chatComplete — single call, schemaMode-driven, stream aggregation"
```

---

## Task 8: failover.mjs — chatCompleteForPurpose + resolveModelChain

**Files:**
- Create: `packages/boss-auto-browse-and-chat/llm/failover.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm/failover.test.mjs`

`resolveModelChain(config, purpose)`:三级回落(purpose → default → 全局启用顺序)。`chatCompleteForPurpose(config, purpose, messages, { schema, maxOutputTokens, _chatComplete })`:逐模型用 decideNext 驱动 retry/endpoint降级/schema降级/换模型;全失败抛脱敏聚合错误。`_chatComplete` 可注入便于测试。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/llm/failover.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelChain, chatCompleteForPurpose } from './failover.mjs'
import { LlmError } from './errors.mjs'

const config = {
  version: 2,
  providers: [{
    id: 'p1', baseURL: 'https://api.siliconflow.cn/v1', apiKey: 'sk-1',
    models: [
      { id: 'm1', model: 'A', enabled: true, brand: 'auto', endpoint: 'auto', thinking: {}, sampling: {} },
      { id: 'm2', model: 'B', enabled: true, brand: 'auto', endpoint: 'auto', thinking: {}, sampling: {} }
    ]
  }],
  purposes: { resume_screening: { modelIds: ['m2', 'm1'] }, default: { modelIds: ['m1'] } },
  retry: { maxAttemptsPerModel: 2, backoffMs: 1, maxBackoffMs: 10, totalDeadlineMs: 5000 }
}

test('resolveModelChain: purpose chain first', () => {
  const chain = resolveModelChain(config, 'resume_screening')
  assert.deepEqual(chain.map((m) => m.id), ['m2', 'm1'])
})

test('resolveModelChain: empty purpose → default chain', () => {
  const chain = resolveModelChain({ ...config, purposes: { rubric_generation: { modelIds: [] }, default: { modelIds: ['m1'] } } }, 'rubric_generation')
  assert.deepEqual(chain.map((m) => m.id), ['m1'])
})

test('resolveModelChain: empty purpose+default → global enabled order', () => {
  const chain = resolveModelChain({ ...config, purposes: { default: { modelIds: [] } } }, 'x')
  assert.deepEqual(chain.map((m) => m.id), ['m1', 'm2'])
})

test('success on first model', async () => {
  const fake = async (model) => ({ content: 'ok', parsed: { v: model.model }, usage: {}, raw: {} })
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake })
  assert.equal(r.parsed.v, 'B') // m2 first
})

test('rate_limit retries same model then succeeds', async () => {
  let n = 0
  const fake = async () => {
    n++
    if (n < 2) throw Object.assign(new Error('rl'), { status: 429 })
    return { content: 'ok', parsed: { n }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake, _sleep: async () => {} })
  assert.equal(r.parsed.n, 2)
})

test('auth → next model immediately', async () => {
  const calls = []
  const fake = async (model) => {
    calls.push(model.id)
    if (model.id === 'm2') throw Object.assign(new Error('auth'), { status: 401 })
    return { content: 'ok', parsed: { id: model.id }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake })
  assert.deepEqual(calls, ['m2', 'm1'])
  assert.equal(r.parsed.id, 'm1')
})

test('schema downgrade walks chain within same model', async () => {
  const modes = []
  const fake = async (model, msgs, opts) => {
    modes.push(opts.schemaMode)
    if (opts.schemaMode !== 'prompt-only') throw new LlmError('invalid_output', 'bad')
    return { content: 'ok', parsed: { ok: true }, usage: {}, raw: {} }
  }
  const r = await chatCompleteForPurpose(
    { ...config, purposes: { resume_screening: { modelIds: ['m1'] }, default: { modelIds: [] } } },
    'resume_screening', [], { schema: { name: 'r', schema: { type: 'object' } }, _chatComplete: fake, _sleep: async () => {} }
  )
  assert.deepEqual(modes, ['json_object', 'prompt-only']) // generic+plain family caps json_schema→but deepseek? here model A unknown → json_object start
  assert.equal(r.parsed.ok, true)
})

test('all fail → aggregate error, no apiKey leak', async () => {
  const fake = async () => { throw Object.assign(new Error('boom sk-1 secret'), { status: 500 }) }
  await assert.rejects(
    chatCompleteForPurpose(config, 'resume_screening', [], { _chatComplete: fake, _sleep: async () => {} }),
    (e) => /all models failed/i.test(e.message) && !/sk-1/.test(e.message)
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm/failover.test.mjs`
Expected: FAIL。

- [ ] **Step 3: Write implementation**

`packages/boss-auto-browse-and-chat/llm/failover.mjs`:

```js
import { classifyError, decideNext } from './errors.mjs'
import { chatComplete as realChatComplete } from './chat-complete.mjs'
import { resolveModelFamily } from './families.mjs'
import { resolveDialect } from './dialects/index.mjs'
import { resolveModelProfile } from './profiles.mjs'

const SCHEMA_CHAIN = ['json_schema', 'json_object', 'prompt-only']

function flattenEnabled (config) {
  const out = []
  for (const p of config.providers || []) {
    for (const m of p.models || []) {
      if (m.enabled === false) continue
      out.push({ ...m, baseURL: p.baseURL, apiKey: p.apiKey })
    }
  }
  return out
}

/**
 * resolveModelChain(config, purpose) — 三级回落:purpose → default → 全局启用顺序。
 */
export function resolveModelChain (config, purpose) {
  const all = flattenEnabled(config)
  const byId = (ids) => (ids || []).map((id) => all.find((m) => m.id === id)).filter(Boolean)

  const p = byId(config.purposes?.[purpose]?.modelIds)
  if (p.length) return p
  const d = byId(config.purposes?.default?.modelIds)
  if (d.length) return d
  return all
}

function initSchemaMode (model, schema) {
  if (!schema) return 'none'
  const family = resolveModelFamily(model.model)
  const dialect = resolveDialect({ baseURL: model.baseURL, brandLock: model.brand, endpoint: model.endpoint, family })
  const profile = resolveModelProfile({ dialect, family, userOverrides: {} })
  return profile.structuredOutput === 'none' ? 'prompt-only' : profile.structuredOutput
}

function redact (msg, model) {
  let s = String(msg ?? '')
  if (model?.apiKey) s = s.split(model.apiKey).join('***')
  return s.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * chatCompleteForPurpose(config, purpose, messages, opts)。
 * opts: { schema, maxOutputTokens, sampling, _chatComplete, _sleep }
 */
export async function chatCompleteForPurpose (config, purpose, messages, opts = {}) {
  const chat = opts._chatComplete || realChatComplete
  const sleep = opts._sleep || defaultSleep
  const retry = config.retry || { maxAttemptsPerModel: 2, backoffMs: 500, maxBackoffMs: 20000, totalDeadlineMs: 120000 }
  const chain = resolveModelChain(config, purpose)
  const deadline = Date.now() + (retry.totalDeadlineMs ?? 120000)
  const failures = []

  for (const model of chain) {
    let currentEndpoint = model.endpoint === 'auto'
      ? (resolveModelProfile({
          dialect: resolveDialect({ baseURL: model.baseURL, brandLock: model.brand, endpoint: 'auto', family: resolveModelFamily(model.model) }),
          family: resolveModelFamily(model.model), userOverrides: {}
        }).endpoint)
      : model.endpoint
    let schemaMode = initSchemaMode(model, opts.schema)
    let retrySameCount = 0
    let working = { ...model, endpoint: currentEndpoint }

    // 同模型循环:retry_same / endpoint_downgrade / schema_downgrade
    // 上限保护:总步数不超过 maxAttempts + chain 长度
    for (let guard = 0; guard < (retry.maxAttemptsPerModel + 5); guard++) {
      if (Date.now() > deadline) {
        failures.push({ id: model.id, kind: 'deadline' })
        return throwAggregate(failures, model)
      }
      try {
        return await chat(working, messages, {
          schema: opts.schema, sampling: opts.sampling, maxOutputTokens: opts.maxOutputTokens, schemaMode
        })
      } catch (err) {
        const { kind, retryAfterMs } = classifyError(err)
        const action = decideNext(kind, {
          retrySameCount, maxAttemptsPerModel: retry.maxAttemptsPerModel,
          configuredEndpoint: model.endpoint, currentEndpoint, schemaMode
        })
        if (action === 'retry_same') {
          retrySameCount++
          const backoff = Math.min(retryAfterMs ?? retry.backoffMs * Math.pow(2, retrySameCount - 1), retry.maxBackoffMs ?? 20000)
          const jitter = backoff * 0.2 * ((retrySameCount % 3) / 3) // 确定性 jitter(不用 Math.random)
          await sleep(backoff + jitter)
          continue
        }
        if (action === 'endpoint_downgrade') {
          currentEndpoint = 'chat'
          working = { ...working, endpoint: 'chat' }
          continue
        }
        if (action === 'schema_downgrade') {
          const idx = SCHEMA_CHAIN.indexOf(schemaMode)
          schemaMode = SCHEMA_CHAIN[Math.min(idx + 1, SCHEMA_CHAIN.length - 1)]
          continue
        }
        // next_model
        failures.push({ id: model.id, kind, reason: redact(err.message, model) })
        break
      }
    }
  }
  return throwAggregate(failures, null)
}

function throwAggregate (failures, model) {
  const detail = failures.map((f) => `${f.id}:${f.kind}`).join(', ')
  const e = new Error(`all models failed [${detail}]`)
  e.failures = failures
  throw e
}
```

> **Note:** `schema downgrade walks chain` 测试里 model A 的 family 未命中已知品牌 → `structuredOutputCap='json_object'`,故初值 `json_object` → `prompt-only`(2 步)。测试断言已按此写。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm/failover.test.mjs`
Expected: PASS(8 tests)。若 `schema downgrade` 用例的 modes 断言不符,核对 model A 的 family 解析(应为非已知品牌 → json_object 起步)。

- [ ] **Step 5: Run the full llm suite**

Run: `node --test packages/boss-auto-browse-and-chat/llm/`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm/failover.mjs packages/boss-auto-browse-and-chat/llm/failover.test.mjs
git commit -m "feat(boss-llm): chatCompleteForPurpose — 3-tier chain + retry/endpoint/schema downgrade failover"
```

---

## Task 9: 配置 v2 迁移 + 持久化硬化

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/runtime-file-utils.mjs:280-386`
- Test: `packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs`

升级 `readBossLlmConfig`/`writeBossLlmConfig`:迁移到 v2(补 `endpoint:'auto'`、补全 5 个 purposes、完整 retry、`brand`、`sampling`、`thinking`),严格 JSON、坏 JSON 备份、原子写、已知字段非法值回落默认、未知字段保留。为可测,把纯迁移逻辑抽成导出的纯函数 `migrateToV2(raw)`。

- [ ] **Step 1: Write the failing test**

`packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateToV2 } from './runtime-file-utils.mjs'

test('v1 providers → v2: adds brand/endpoint/sampling/thinking, all purposes, retry', () => {
  const v1 = {
    providers: [{ id: 'p', baseURL: 'u', apiKey: 'k', models: [{ id: 'm', model: 'A', enabled: true }] }],
    purposeDefaultModelId: { resume_screening: 'm' }
  }
  const v2 = migrateToV2(v1)
  assert.equal(v2.version, 2)
  const m = v2.providers[0].models[0]
  assert.equal(m.brand, 'auto')
  assert.equal(m.endpoint, 'auto')
  assert.ok(m.sampling && 'temperature' in m.sampling)
  assert.ok(m.thinking && typeof m.thinking.enabled === 'boolean')
  assert.deepEqual(v2.purposes.resume_screening.modelIds, ['m'])
  for (const k of ['resume_screening', 'rubric_generation', 'greeting_generation', 'message_rewrite', 'default']) {
    assert.ok(v2.purposes[k])
  }
  assert.ok(v2.retry.maxAttemptsPerModel >= 1 && 'totalDeadlineMs' in v2.retry)
})

test('flat models[] → v2 providers', () => {
  const flat = { models: [{ id: 'm', baseURL: 'u', apiKey: 'k', model: 'A' }] }
  const v2 = migrateToV2(flat)
  assert.equal(v2.version, 2)
  assert.equal(v2.providers[0].models[0].brand, 'auto')
})

test('invalid known field value → falls back, config not discarded', () => {
  const bad = {
    version: 2,
    providers: [{ id: 'p', baseURL: 'u', apiKey: 'k', models: [{ id: 'm', model: 'A', endpoint: 'weird', enabled: true }] }],
    purposes: {}, retry: { maxAttemptsPerModel: -3 }
  }
  const v2 = migrateToV2(bad)
  assert.equal(v2.providers[0].models[0].endpoint, 'auto') // invalid → default
  assert.ok(v2.retry.maxAttemptsPerModel >= 1) // negative → default
})

test('unknown fields preserved', () => {
  const x = { version: 2, providers: [], purposes: {}, retry: {}, _customField: 42 }
  const v2 = migrateToV2(x)
  assert.equal(v2._customField, 42)
})

test('already-v2 is idempotent', () => {
  const once = migrateToV2({ providers: [], purposeDefaultModelId: {} })
  const twice = migrateToV2(once)
  assert.deepEqual(twice.purposes, once.purposes)
  assert.equal(twice.version, 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs`
Expected: FAIL(`migrateToV2` 未导出)。

- [ ] **Step 3: Implement migrateToV2 + rewire read/write**

替换 `runtime-file-utils.mjs` 中 `// ── 招聘端 LLM 配置` 段(`bossLlmConfigFileName` 起至文件末)为:

```js
// ── 招聘端 LLM 配置(boss-llm.json v2)─────────────────────────────────────────

const bossLlmConfigFileName = 'boss-llm.json'

const PURPOSE_KEYS = ['resume_screening', 'rubric_generation', 'greeting_generation', 'message_rewrite', 'default']
const VALID_ENDPOINT = ['auto', 'chat', 'responses']
const VALID_BRAND = ['auto', 'qwen', 'deepseek', 'glm', 'openai', 'generic']

function defaultRetry () {
  return { maxAttemptsPerModel: 2, backoffMs: 500, maxBackoffMs: 20000, totalDeadlineMs: 120000 }
}

function defaultSampling () {
  return { temperature: null, max_tokens: null, top_p: null, frequency_penalty: null, presence_penalty: null }
}

function defaultThinking () {
  return { enabled: false, budget: 2048, effort: 'medium' }
}

function normalizeModel (m) {
  if (!m || typeof m !== 'object') return null
  const out = { ...m }
  if (typeof out.id !== 'string' || !out.id) out.id = crypto.randomUUID()
  if (typeof out.enabled !== 'boolean') out.enabled = true
  if (!VALID_BRAND.includes(out.brand)) out.brand = 'auto'
  if (!VALID_ENDPOINT.includes(out.endpoint)) out.endpoint = 'auto'
  out.sampling = { ...defaultSampling(), ...(out.sampling && typeof out.sampling === 'object' ? out.sampling : {}) }
  const t = out.thinking && typeof out.thinking === 'object' ? out.thinking : {}
  out.thinking = {
    enabled: typeof t.enabled === 'boolean' ? t.enabled : false,
    budget: typeof t.budget === 'number' ? t.budget : 2048,
    effort: typeof t.effort === 'string' ? t.effort : 'medium'
  }
  return out
}

function migrateFlatModelsToProviders (oldConfig) {
  const grouped = {}
  for (const m of oldConfig.models) {
    const key = m.baseURL ?? ''
    if (!grouped[key]) {
      grouped[key] = { id: crypto.randomUUID(), name: m.baseURL ?? '', baseURL: m.baseURL ?? '', apiKey: m.apiKey ?? '', models: [] }
    }
    const { baseURL: _b, apiKey: _a, ...rest } = m
    grouped[key].models.push(rest)
  }
  return { providers: Object.values(grouped), purposeDefaultModelId: oldConfig.purposeDefaultModelId ?? {} }
}

/**
 * migrateToV2(raw) — 纯函数,幂等。补全 v2 形状,非法已知字段回落默认,未知字段保留。
 */
export function migrateToV2 (raw) {
  let base = raw && typeof raw === 'object' ? { ...raw } : {}
  // flat models[] → providers
  if (Array.isArray(base.models) && !Array.isArray(base.providers)) {
    const migrated = migrateFlatModelsToProviders(base)
    base = { ...base, providers: migrated.providers, purposeDefaultModelId: migrated.purposeDefaultModelId }
    delete base.models
  }
  if (!Array.isArray(base.providers)) base.providers = []

  // providers/models 规范化
  base.providers = base.providers
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      ...p,
      id: typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID(),
      models: (Array.isArray(p.models) ? p.models : []).map(normalizeModel).filter(Boolean)
    }))

  // purposes:补全 5 键;迁移旧 purposeDefaultModelId
  const purposes = base.purposes && typeof base.purposes === 'object' ? { ...base.purposes } : {}
  const legacy = base.purposeDefaultModelId && typeof base.purposeDefaultModelId === 'object' ? base.purposeDefaultModelId : {}
  for (const k of PURPOSE_KEYS) {
    const existing = purposes[k]
    if (existing && Array.isArray(existing.modelIds)) continue
    if (legacy[k]) purposes[k] = { modelIds: [legacy[k]] }
    else purposes[k] = { modelIds: [] }
  }
  base.purposes = purposes
  delete base.purposeDefaultModelId

  // retry:补全 + 非法值回落
  const r = base.retry && typeof base.retry === 'object' ? base.retry : {}
  const d = defaultRetry()
  base.retry = {
    maxAttemptsPerModel: Number.isInteger(r.maxAttemptsPerModel) && r.maxAttemptsPerModel >= 1 ? r.maxAttemptsPerModel : d.maxAttemptsPerModel,
    backoffMs: typeof r.backoffMs === 'number' && r.backoffMs >= 0 ? r.backoffMs : d.backoffMs,
    maxBackoffMs: typeof r.maxBackoffMs === 'number' && r.maxBackoffMs >= 0 ? r.maxBackoffMs : d.maxBackoffMs,
    totalDeadlineMs: typeof r.totalDeadlineMs === 'number' && r.totalDeadlineMs >= 0 ? r.totalDeadlineMs : d.totalDeadlineMs
  }

  base.version = 2
  return base
}

const defaultBossLlmConfig = () => migrateToV2({})

function atomicWrite (filePath, content) {
  const tmp = filePath + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}

export const readBossLlmConfig = () => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossLlmConfigFileName)
  if (!fs.existsSync(filePath)) return defaultBossLlmConfig()

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    // 坏 JSON:备份后回落默认
    try { fs.copyFileSync(filePath, filePath + '.bak') } catch { /* ignore */ }
    const def = defaultBossLlmConfig()
    try { atomicWrite(filePath, JSON.stringify(def)) } catch { /* ignore */ }
    return def
  }

  const migrated = migrateToV2(raw)
  // 若迁移产生变化,写前备份 + 原子写
  try {
    const before = JSON.stringify(raw)
    const after = JSON.stringify(migrated)
    if (before !== after) {
      try { fs.copyFileSync(filePath, filePath + '.bak') } catch { /* ignore */ }
      atomicWrite(filePath, after)
    }
  } catch { /* 写回失败不影响本次使用 */ }
  return migrated
}

export const writeBossLlmConfig = async (config) => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossLlmConfigFileName)
  const normalized = migrateToV2(config)
  atomicWrite(filePath, JSON.stringify(normalized))
}
```

确认文件顶部已 `import` 了 `fs`、`path`(已存在)。`crypto.randomUUID()` 在 Node ≥ 19 全局可用(本仓 volta node 20.16)。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs`
Expected: PASS(5 tests)。

- [ ] **Step 5: Commit**

```bash
git add packages/boss-auto-browse-and-chat/runtime-file-utils.mjs packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs
git commit -m "feat(boss-llm): v2 config migration + hardened persistence (atomic, backup, field validation)"
```

---

## Task 10: 接入 llm-rubric.mjs(两个函数走新层)

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/llm-rubric.mjs`
- Test: `packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs`

`evaluateResumeByRubric` / `generateRubricFromJd` 改用 `chatCompleteForPurpose(config, purpose, messages, { schema, maxOutputTokens })`,用 `parsed`。保留默认结果(失败兜底)。每用途 token 常量:resume_screening=500、rubric_generation=2000。`getEnabledLlmClient` 保留并标 `@deprecated`(screenCandidateWithLlm 在 Task 11 改),避免一次性大改面。

- [ ] **Step 1: Write the failing test(注入 _chatCompleteForPurpose)**

`packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateResumeByRubric, __setChatCompleteForPurpose } from './llm-rubric.mjs'

test('evaluateResumeByRubric uses new layer parsed result', async () => {
  let captured
  __setChatCompleteForPurpose(async (config, purpose, messages, opts) => {
    captured = { purpose, opts }
    return { parsed: { knockout_failed: false, dimension_scores: { '能力': 5 }, reasoning: 'good' }, usage: {} }
  })
  const rubric = { dimensions: [{ name: '能力', weight: 100, criteria: { '5': 'x' } }], passThreshold: 50 }
  const r = await evaluateResumeByRubric('resume', rubric, {})
  assert.equal(captured.purpose, 'resume_screening')
  assert.equal(captured.opts.maxOutputTokens, 500)
  assert.equal(r.isPassed, true)
  assert.equal(r.totalScore, 100)
  __setChatCompleteForPurpose(null) // reset
})

test('evaluateResumeByRubric: layer throws → default pass', async () => {
  __setChatCompleteForPurpose(async () => { throw new Error('all models failed') })
  const r = await evaluateResumeByRubric('resume', { dimensions: [{ name: 'a', weight: 100, criteria: {} }] }, {})
  assert.equal(r.isPassed, true) // 兜底默认通过
  __setChatCompleteForPurpose(null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs`
Expected: FAIL(`__setChatCompleteForPurpose` 未导出)。

- [ ] **Step 3: Implement — add seam + rewire evaluateResumeByRubric**

在 `llm-rubric.mjs` 顶部(import 之后)加测试缝:

```js
import { readBossLlmConfig } from './runtime-file-utils.mjs'

// 测试缝:默认用真实新层,测试可注入
let _chatCompleteForPurpose = null
export function __setChatCompleteForPurpose (fn) { _chatCompleteForPurpose = fn }
async function callLayer (config, purpose, messages, opts) {
  if (_chatCompleteForPurpose) return _chatCompleteForPurpose(config, purpose, messages, opts)
  const { chatCompleteForPurpose } = await import('./llm/failover.mjs')
  return chatCompleteForPurpose(config, purpose, messages, opts)
}

const RESUME_SCREENING_MAX_TOKENS = 500
const RUBRIC_GENERATION_MAX_TOKENS = 2000
```

把 `evaluateResumeByRubric` 主体中调用 `completes(...)` 与 JSON 解析部分,替换为:

```js
  // schema:rubric 评分输出
  const schema = {
    name: 'rubric_eval',
    schema: {
      type: 'object',
      required: ['knockout_failed', 'dimension_scores'],
      properties: {
        knockout_failed: { type: 'boolean' },
        knockout_reason: { type: 'string' },
        dimension_scores: { type: 'object' },
        reasoning: { type: 'string' }
      }
    }
  }
  try {
    logInfo(LOG, 'evaluateResumeByRubric start', { dims: dimensions.length, knockouts: knockouts.length, passThreshold })
    const config = readBossLlmConfig()
    const r = await callLayer(config, 'resume_screening', [
      { role: 'system', content: systemContent },
      { role: 'user', content: truncatedResume }
    ], { schema, maxOutputTokens: RESUME_SCREENING_MAX_TOKENS })
    const parsed = r?.parsed
    if (!parsed) return defaultResult

    if (parsed.knockout_failed === true) {
      return { isPassed: false, totalScore: 0, reason: String(parsed.knockout_reason || parsed.reasoning || '一票否决') }
    }
    const scores = parsed.dimension_scores || {}
    let weightedSum = 0
    let totalWeight = 0
    const dimensionResults = []
    for (const d of dimensions) {
      const score = scores[d.name]
      const num = typeof score === 'number' ? Math.min(5, Math.max(1, score)) : 3
      const weight = typeof d.weight === 'number' ? d.weight : 100 / dimensions.length
      weightedSum += (num / 5) * weight
      totalWeight += weight
      dimensionResults.push({ name: d.name, score: num, weight })
    }
    const totalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0
    return { isPassed: totalScore >= passThreshold, totalScore, reason: String(parsed.reasoning || ''), dimensionResults }
  } catch (err) {
    logError(LOG, 'evaluateResumeByRubric error', err?.message || err)
    return { ...defaultResult, reason: `评估异常: ${err?.message || err}` }
  }
```

> 注意:`modelId` 选项不再用于精确选模型(failover 链取代)。保留 `options` 形参签名不变以免破坏调用方;若 `options.modelId` 存在,可忽略(链已按用途解析)。删除函数体内对 `getEnabledLlmClient('resume_screening', modelId)` 的早退 `if (!client) return defaultResult`(改为永远尝试新层)。

- [ ] **Step 4: Rewire generateRubricFromJd similarly**

把 `generateRubricFromJd` 中 `completes(...)` 调用与解析替换为 `callLayer(config, 'rubric_generation', [...], { schema, maxOutputTokens: RUBRIC_GENERATION_MAX_TOKENS })`,schema:

```js
  const schema = {
    name: 'rubric_gen',
    schema: { type: 'object', required: ['dimensions'], properties: { knockouts: { type: 'array' }, dimensions: { type: 'array' } } }
  }
```

用 `r.parsed` 取代原 `JSON.parse(jsonStr)`;`if (!r?.parsed) return { rubric: defaultRubric }`;其余 knockouts/dimensions 归一化逻辑不变。删除 `getEnabledLlmClient('rubric_generation', modelId)` 的早退。

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs`
Expected: PASS。

- [ ] **Step 6: Run existing scorer test (no regression)**

Run: `node --test packages/boss-auto-browse-and-chat/recommend/scorer.test.mjs`
Expected: PASS(scorer 注入 fakeLlm,不受影响)。

- [ ] **Step 7: Commit**

```bash
git add packages/boss-auto-browse-and-chat/llm-rubric.mjs packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs
git commit -m "feat(boss-llm): route rubric eval + generation through new failover layer"
```

---

## Task 11: 接入 chat-page-processor.mjs(screenCandidateWithLlm)

**Files:**
- Modify: `packages/boss-auto-browse-and-chat/chat-page-processor.mjs:136-170`

`screenCandidateWithLlm(resumeText, llmRule)` 改走新层(purpose `resume_screening`,maxOutputTokens 200,schema pass/reason)。无独立单测(集成于流程);用现有运行验证。

- [ ] **Step 1: Replace implementation**

把 `screenCandidateWithLlm` 函数体替换为:

```js
export async function screenCandidateWithLlm (resumeText, llmRule) {
  const defaultResult = { pass: true, reason: 'LLM 调用失败,默认通过' }
  try {
    const { readBossLlmConfig } = await import('./runtime-file-utils.mjs')
    const { chatCompleteForPurpose } = await import('./llm/failover.mjs')
    const config = readBossLlmConfig()
    const systemContent = `你是一个招聘筛选助手。根据以下筛选规则,判断候选人简历是否符合要求。
筛选规则:${llmRule || '无'}
请仅以JSON格式回复,不要包含其他内容。格式:{"pass": true或false, "reason": "判断理由"}`
    const schema = {
      name: 'screen',
      schema: { type: 'object', required: ['pass'], properties: { pass: { type: 'boolean' }, reason: { type: 'string' } } }
    }
    const r = await chatCompleteForPurpose(config, 'resume_screening', [
      { role: 'system', content: systemContent },
      { role: 'user', content: (resumeText || '（无简历内容）').slice(0, 3500) }
    ], { schema, maxOutputTokens: 200 })
    const parsed = r?.parsed
    if (!parsed) return defaultResult
    return { pass: !!parsed.pass, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
  } catch (err) {
    logWarn(`${LOG} screenCandidateWithLlm 失败:`, err.message)
    return defaultResult
  }
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check packages/boss-auto-browse-and-chat/chat-page-processor.mjs`
Expected: 无输出(语法 OK)。

- [ ] **Step 3: Lint the boss llm files**

Run: `pnpm -F geekgeekrun-ui exec eslint ../boss-auto-browse-and-chat/llm --ext .mjs` (若 boss 包无 eslint 配置,跳过此步,改为下一步)
Alternative: `node --check` 各新文件。

- [ ] **Step 4: Commit**

```bash
git add packages/boss-auto-browse-and-chat/chat-page-processor.mjs
git commit -m "feat(boss-llm): route screenCandidateWithLlm through new failover layer"
```

---

## Task 12: IPC — boss-detect-brand(供 UI 显示自动识别品牌)

**Files:**
- Modify: `packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts:476`(在 boss-test-llm-endpoint 之后)

UI 模型卡要显示「自动识别 → X」,需调用后端解析。加只读 IPC。

- [ ] **Step 1: Add handler**

在 `boss-test-llm-endpoint` handler 之后、`// ── end 招聘端 LLM 配置窗口` 之前插入:

```ts
  ipcMain.handle('boss-detect-brand', async (_, payload: { baseURL: string; model: string; endpoint?: string }) => {
    try {
      const { resolveModelFamily } = await import('@geekgeekrun/boss-auto-browse-and-chat/llm/families.mjs')
      const { resolveDialect } = await import('@geekgeekrun/boss-auto-browse-and-chat/llm/dialects/index.mjs')
      const family = resolveModelFamily(payload.model)
      const dialect = resolveDialect({
        baseURL: payload.baseURL,
        brandLock: 'auto',
        endpoint: payload.endpoint ?? 'auto',
        family
      })
      return {
        dialectId: dialect.id,
        label: dialect.label,
        isReasoningModel: family.isReasoningModel,
        effortValues: family.effortValues ?? null,
        thinkingStyle: dialect.thinkingStyle
      }
    } catch (err: unknown) {
      return { dialectId: 'generic', label: '通用兼容', isReasoningModel: false, effortValues: null, thinkingStyle: 'top_level_enable' }
    }
  })
```

- [ ] **Step 2: Verify boss package exports subpath**

确认 `packages/boss-auto-browse-and-chat/package.json` 的 `exports`/`main` 允许 `@geekgeekrun/boss-auto-browse-and-chat/llm/...` 子路径导入。Run: `node -e "console.log(JSON.stringify(require('./packages/boss-auto-browse-and-chat/package.json').exports||'no exports field'))"`
- 若有 `exports` 且不含通配,需加 `"./llm/*": "./llm/*"` 与 `"./runtime-file-utils.mjs": "./runtime-file-utils.mjs"`(后者若已被现有 IPC import 成功则已 OK)。
- 若无 `exports` 字段(全量可导入),无需改。

- [ ] **Step 3: typecheck node side**

Run: `pnpm -F geekgeekrun-ui typecheck:node`
Expected: 无新增类型错误。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/main/flow/OPEN_SETTING_WINDOW/ipc/index.ts packages/boss-auto-browse-and-chat/package.json
git commit -m "feat(boss-llm): boss-detect-brand IPC for UI auto-detection display"
```

---

## Task 13: 配置 UI 重写 — 三标签页

**Files:**
- Modify: `packages/ui/src/renderer/src/page/BossLlmConfig/index.vue`(整文件重写)

Vue 3 `<script setup>` + Element Plus。三 Tab:模型 / 用途分配 / 通用。沿用 `boss-fetch-llm-config` / `boss-save-llm-config` / `boss-test-llm-endpoint` / `boss-detect-brand`(via `window.electron.ipcRenderer.invoke`,与现有文件一致——先确认现有调用方式)。

> 因体量较大,本任务分步:先读现有文件确认 IPC 调用约定与样式基线,再按下述结构重写。每个子部分一个 commit 可选;最少在 Step 末整体 commit。

- [ ] **Step 1: Read current file for IPC/style baseline**

Read: `packages/ui/src/renderer/src/page/BossLlmConfig/index.vue`(全文件)。记录:
- IPC 调用方式(`window.electron.ipcRenderer.invoke('boss-fetch-llm-config')` 还是别的封装)
- Element Plus 组件用法、是否已 import、`<style>` scope

- [ ] **Step 2: Write `<script setup>` — state + load/save + detect**

`<script setup>` 关键状态与方法(用 Composition API):

```js
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'

const activeTab = ref('models')
const config = reactive({ version: 2, providers: [], purposes: {}, retry: {} })
const PURPOSE_LABELS = {
  resume_screening: '简历筛选',
  rubric_generation: '评分标准生成',
  greeting_generation: '招呼语生成（预留）',
  message_rewrite: '消息续写（预留）',
  default: '默认'
}
const BRAND_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: 'GLM' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'generic', label: '通用兼容' }
]

const ipc = window.electron.ipcRenderer // 若现有文件用别的封装,以现有为准

async function load () {
  const raw = await ipc.invoke('boss-fetch-llm-config')
  config.version = raw.version ?? 2
  config.providers = raw.providers ?? []
  config.purposes = raw.purposes ?? {}
  config.retry = raw.retry ?? { maxAttemptsPerModel: 2, backoffMs: 500, maxBackoffMs: 20000, totalDeadlineMs: 120000 }
}
async function save () {
  await ipc.invoke('boss-save-llm-config', JSON.parse(JSON.stringify(config)))
  ElMessage.success('已保存')
}

// 自动识别缓存:key = providerId:modelId
const detected = reactive({})
async function detectBrand (provider, model) {
  if (!model.model || !provider.baseURL) return
  const res = await ipc.invoke('boss-detect-brand', { baseURL: provider.baseURL, model: model.model, endpoint: model.endpoint })
  detected[model.id] = res
}

function addProvider () {
  config.providers.push({ id: crypto.randomUUID(), name: '新服务商', baseURL: '', apiKey: '', models: [] })
}
function addModel (provider) {
  provider.models.push({
    id: crypto.randomUUID(), name: '新模型', model: '', enabled: true,
    brand: 'auto', endpoint: 'auto',
    thinking: { enabled: false, budget: 2048, effort: 'medium' },
    sampling: { temperature: null, max_tokens: null, top_p: null, frequency_penalty: null, presence_penalty: null }
  })
}
function removeModel (provider, idx) { provider.models.splice(idx, 1) }
function removeProvider (idx) { config.providers.splice(idx, 1) }

async function testProvider (provider) {
  const res = await ipc.invoke('boss-test-llm-endpoint', { baseURL: provider.baseURL, apiKey: provider.apiKey })
  if (res.ok) ElMessage.success('连接成功')
  else ElMessage.error('连接失败: ' + res.error)
}

// 用途分配:把模型 id 加入/移出某用途链
function allEnabledModels () {
  return config.providers.flatMap((p) => p.models.filter((m) => m.enabled).map((m) => ({ id: m.id, label: m.name || m.model })))
}
function purposeChain (key) {
  if (!config.purposes[key]) config.purposes[key] = { modelIds: [] }
  return config.purposes[key].modelIds
}

// thinking 控件类型:看 detected[model.id].thinkingStyle
function thinkingKind (model) {
  const d = detected[model.id]
  const style = model.brand === 'auto' ? d?.thinkingStyle : brandToStyle(model.brand)
  if (style === 'reasoning_effort') return 'effort'
  if (style === 'thinking_type') return 'toggle'
  if (style === 'model_name') return 'model_name'
  return 'budget'
}
function brandToStyle (brand) {
  return { qwen: 'qwen_enable', deepseek: 'model_name', glm: 'thinking_type', openai: 'reasoning_effort', generic: 'top_level_enable' }[brand] || 'top_level_enable'
}
function effortValues (model) {
  return detected[model.id]?.effortValues ?? ['low', 'medium', 'high']
}

onMounted(load)
```

- [ ] **Step 3: Write `<template>` — Tab 1 模型**

模型 Tab(`el-tabs` + `el-tab-pane name="models"`):服务商卡列表,每卡含 name/baseURL/apiKey + 测试连接 + 模型卡列表。模型卡含:启用开关、别名、删除、Model ID(`@blur="detectBrand(provider, model)"`)、品牌行(徽章显示 `detected[model.id].label` + brand 下拉)、Endpoint 选择(仅 detected.dialectId 以 `openai` 开头时显示)、Thinking 控件(按 `thinkingKind(model)`:budget→开关+数字框;toggle→仅开关;effort→开关+`effortValues` 单选;model_name→只读提示)、高级参数折叠(5 个 sampling 数字框,留空=null)。

```html
<template>
  <div class="boss-llm-config">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="模型" name="models">
        <div v-for="(provider, pi) in config.providers" :key="provider.id" class="provider-card">
          <div class="provider-head">
            <el-input v-model="provider.name" placeholder="服务商名称" style="width:180px" />
            <el-input v-model="provider.baseURL" placeholder="Base URL" style="width:280px" />
            <el-input v-model="provider.apiKey" placeholder="API Key" type="password" show-password style="width:220px" />
            <el-button @click="testProvider(provider)">测试连接</el-button>
            <el-button @click="addModel(provider)">+ 模型</el-button>
            <el-button type="danger" text @click="removeProvider(pi)">删除服务商</el-button>
          </div>
          <div v-for="(model, mi) in provider.models" :key="model.id" class="model-card">
            <div class="model-head">
              <el-switch v-model="model.enabled" />
              <el-input v-model="model.name" placeholder="别名" style="width:200px" />
              <el-button type="danger" text @click="removeModel(provider, mi)">删除</el-button>
            </div>
            <el-input v-model="model.model" placeholder="Model ID" @blur="detectBrand(provider, model)" />
            <div class="brand-row">
              <span>品牌：</span>
              <el-tag v-if="model.brand === 'auto' && detected[model.id]">自动识别 → {{ detected[model.id].label }}</el-tag>
              <el-select v-model="model.brand" style="width:160px" @change="detectBrand(provider, model)">
                <el-option v-for="b in BRAND_OPTIONS" :key="b.value" :value="b.value" :label="b.label" />
              </el-select>
            </div>
            <div v-if="(detected[model.id]?.dialectId || '').startsWith('openai') || model.brand === 'openai'" class="endpoint-row">
              <span>Endpoint：</span>
              <el-select v-model="model.endpoint" style="width:160px" @change="detectBrand(provider, model)">
                <el-option value="auto" label="自动" />
                <el-option value="chat" label="Chat" />
                <el-option value="responses" label="Responses" />
              </el-select>
            </div>
            <div class="thinking-row">
              <template v-if="thinkingKind(model) === 'budget'">
                <el-checkbox v-model="model.thinking.enabled">启用 Thinking</el-checkbox>
                <el-input-number v-if="model.thinking.enabled" v-model="model.thinking.budget" :min="128" :max="32768" />
              </template>
              <template v-else-if="thinkingKind(model) === 'toggle'">
                <el-checkbox v-model="model.thinking.enabled">启用 Thinking</el-checkbox>
              </template>
              <template v-else-if="thinkingKind(model) === 'effort'">
                <el-checkbox v-model="model.thinking.enabled">启用</el-checkbox>
                <el-radio-group v-if="model.thinking.enabled" v-model="model.thinking.effort">
                  <el-radio-button v-for="ev in effortValues(model)" :key="ev" :label="ev">{{ ev }}</el-radio-button>
                </el-radio-group>
              </template>
              <template v-else>
                <span class="hint">该模型由模型名决定是否推理</span>
              </template>
            </div>
            <el-collapse>
              <el-collapse-item title="高级参数（留空=自动）">
                <el-input-number v-model="model.sampling.temperature" :precision="2" placeholder="temperature" controls-position="right" />
                <el-input-number v-model="model.sampling.max_tokens" placeholder="max_tokens" controls-position="right" />
                <el-input-number v-model="model.sampling.top_p" :precision="2" placeholder="top_p" controls-position="right" />
                <el-input-number v-model="model.sampling.frequency_penalty" :precision="2" placeholder="frequency_penalty" controls-position="right" />
                <el-input-number v-model="model.sampling.presence_penalty" :precision="2" placeholder="presence_penalty" controls-position="right" />
              </el-collapse-item>
            </el-collapse>
          </div>
        </div>
        <el-button @click="addProvider">+ 添加服务商</el-button>
      </el-tab-pane>

      <el-tab-pane label="用途分配" name="purposes">
        <div v-for="(label, key) in PURPOSE_LABELS" :key="key" class="purpose-row">
          <div class="purpose-title">{{ label }}</div>
          <el-select v-model="config.purposes[key].modelIds" multiple style="width:480px" placeholder="留空 = 回落 default / 全局启用顺序" v-if="config.purposes[key]">
            <el-option v-for="m in allEnabledModels()" :key="m.id" :value="m.id" :label="m.label" />
          </el-select>
        </div>
        <p class="hint">提示：多选顺序即 failover 顺序；留空则按 默认 链、再按全局启用顺序兜底。</p>
      </el-tab-pane>

      <el-tab-pane label="通用" name="general">
        <el-form label-width="180px">
          <el-form-item label="每模型最大重试次数"><el-input-number v-model="config.retry.maxAttemptsPerModel" :min="0" /></el-form-item>
          <el-form-item label="退避基数 (ms)"><el-input-number v-model="config.retry.backoffMs" :min="0" /></el-form-item>
          <el-form-item label="退避上限 (ms)"><el-input-number v-model="config.retry.maxBackoffMs" :min="0" /></el-form-item>
          <el-form-item label="总超时 (ms)"><el-input-number v-model="config.retry.totalDeadlineMs" :min="0" /></el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="footer">
      <el-button type="primary" @click="save">保存</el-button>
    </div>
  </div>
</template>
```

> `el-select multiple` 的选中顺序即数组顺序,满足「有序 failover 链」(拖拽排序为增强,YAGNI,本版用多选顺序)。`config.purposes[key]` 在 load 时已由后端补全 5 键,故模板可直接绑定;保险起见可在 `load()` 后确保每个 PURPOSE_LABELS key 存在。

- [ ] **Step 4: Ensure purposes keys exist after load (defensive)**

在 `load()` 末尾加:

```js
  for (const k of Object.keys(PURPOSE_LABELS)) {
    if (!config.purposes[k] || !Array.isArray(config.purposes[k].modelIds)) config.purposes[k] = { modelIds: [] }
  }
```

- [ ] **Step 5: Minimal `<style scoped>`**

```html
<style scoped>
.provider-card { border: 1px solid #ebeef5; border-radius: 8px; padding: 12px; margin-bottom: 16px }
.provider-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px }
.model-card { border: 1px dashed #dcdfe6; border-radius: 6px; padding: 10px; margin: 8px 0 }
.model-head, .brand-row, .endpoint-row, .thinking-row { display: flex; gap: 8px; align-items: center; margin: 6px 0 }
.purpose-row { margin-bottom: 14px }
.purpose-title { font-weight: 600; margin-bottom: 6px }
.hint { color: #909399; font-size: 12px }
.footer { margin-top: 16px }
</style>
```

- [ ] **Step 6: typecheck web + lint**

Run: `pnpm -F geekgeekrun-ui typecheck:web`
Expected: 无新增错误(若 `window.electron` 类型未知,沿用现有文件的访问方式即可)。
Run: `pnpm -F geekgeekrun-ui lint`
Expected: 自动修复后无报错。

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/renderer/src/page/BossLlmConfig/index.vue
git commit -m "feat(boss-llm): 3-tab config UI (models / purpose routing / general)"
```

---

## Task 14: 全量回归 + 构建冒烟

**Files:** 无(验证)

- [ ] **Step 1: Run all boss llm + config tests**

Run: `node --test packages/boss-auto-browse-and-chat/llm/ packages/boss-auto-browse-and-chat/boss-llm-config.test.mjs packages/boss-auto-browse-and-chat/llm-rubric-newlayer.test.mjs`
Expected: 全 PASS。

- [ ] **Step 2: Run existing recommend tests (no regression)**

Run: `node --test packages/boss-auto-browse-and-chat/recommend/pure/ packages/boss-auto-browse-and-chat/recommend/scorer.test.mjs`
Expected: 全 PASS。

- [ ] **Step 3: typecheck + lint UI**

Run: `pnpm -F geekgeekrun-ui typecheck && pnpm -F geekgeekrun-ui lint`
Expected: 通过。

- [ ] **Step 4: Build smoke (renderer compiles)**

Run: `pnpm -F geekgeekrun-ui build`
Expected: 构建成功(sqlite-plugin 先 build,再 electron-vite build)。若 build 太重/环境受限,至少确保 `typecheck` + `lint` 通过并记录 build 未跑。

- [ ] **Step 5: Commit (if any lint autofix)**

```bash
git add -A
git commit -m "chore(boss-llm): regression pass — tests, typecheck, lint green" || echo "nothing to commit"
```

---

## 测试计划汇总(供 PR「Test Plan」用)

**自动化(node --test):**
1. `llm/families.test.mjs` — model-id 能力解析(含 SiliconFlow 托管 DeepSeek)
2. `llm/dialects/index.test.mjs` — resolveDialect(dialect × endpoint × brandLock)
3. `llm/dialects/build-request.test.mjs` — 各 dialect 线格式 + schemaMode 形态
4. `llm/profiles.test.mjs` — 合并能力(structuredOutput=min)
5. `llm/errors.test.mjs` — classifyError(无状态)+ decideNext(有状态)
6. `llm/schema-validate.test.mjs` — parse + required key,失败 invalid_output
7. `llm/usage.test.mjs` — chat/responses usage 归一化
8. `llm/chat-complete.test.mjs` — 注入 fake client:构造/覆盖/invalid_output
9. `llm/failover.test.mjs` — 三级链、retry、auth→换模型、schema 降级、脱敏聚合
10. `boss-llm-config.test.mjs` — v2 迁移/硬化/幂等/非法回落/未知保留
11. `llm-rubric-newlayer.test.mjs` — rubric 走新层 + 兜底

**手动验收(开发者本机跑 app):**
- 打开「配置大语言模型」(招聘端):三 Tab 显示;加服务商/模型;填 Model ID 后失焦显示「自动识别 → X」;Thinking 控件随品牌变形态(Qwen 数字框 / GLM 仅开关 / OpenAI 档位 / DeepSeek-R1 只读提示);测试连接 GET /models 成功/失败提示;保存后 `~/.geekgeekrun/config/boss-llm.json` 为 v2 形状。
- 旧 `boss-llm.json`(providers 或 flat models)启动后被无感迁移(出现 `.bak`,主文件含 version:2 + 5 purposes + endpoint + retry)。
- 跑一次招聘端简历筛选(有可用 key 时):走 failover,日志无明文 apiKey。

---

## Self-Review Notes(已核对)

- **Spec 覆盖**:§3.1 模块→Task1-9;§3.2 两轴→Task1/2;§3.3 profile→Task3;§3.4 thinking 写法→Task2 各 dialect;§3.5 chatComplete→Task7;§3.6 failover/decideNext→Task4/8;§4 schema+迁移→Task9;§5 UI→Task13;§6 消费方→Task10/11;§7 测试→各 Task 的 test + Task14;§8 非目标(不改 gpt-request、无流式 UI、保留 GET/models)已遵守;§9 风险(Volc 走 generic、OpenAI endpoint 降级、Qwen 流聚合、固定快照)在 Task2/7 落实。
- **类型/命名一致**:`chatComplete`/`chatCompleteForPurpose`/`resolveDialect`/`resolveModelFamily`/`resolveModelProfile`/`classifyError`/`decideNext`/`validateAgainstSchema`/`normalizeUsage`/`migrateToV2` 跨 Task 一致;`schemaMode` 值域 `{none,json_schema,json_object,prompt-only}` 一致;`brand` 枚举 v1 不含 volc(走 generic)。
- **占位符**:无 TODO/TBD;每个代码步均给出完整代码。
