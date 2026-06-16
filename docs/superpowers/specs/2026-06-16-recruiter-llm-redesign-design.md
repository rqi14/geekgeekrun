# 招聘端 LLM 后端与配置 UI 重新设计

- **日期**: 2026-06-16
- **范围**: 仅招聘端(boss / recruiter side)。不改应聘端,不破坏应聘端对 `packages/utils/gpt-request.mjs` 的现有使用。
- **分支**: `feat/recommend-page-redesign`(PR #10)
- **状态**: 设计待评审

## 1. 背景与目标

当前招聘端 LLM 调用集中在 `packages/utils/gpt-request.mjs` 的 `completes()`,thinking 仅支持一种顶层 `enable_thinking`/`thinking_budget` 写法(SiliconFlow / 火山方舟兼容),采样参数写死在各调用点,配置 UI 只暴露 thinking budget。问题:

1. 不同品牌开关 thinking 的方式完全不同(Qwen / DeepSeek / GLM / OpenAI),当前写法对多数品牌不正确。
2. 采样参数(temperature / max_tokens / top_p…)写死、UI 不可配。
3. 缺统一的 provider 抽象、重试、failover、结构化输出。

**目标**:为招聘端建立一个**自包含**的、按品牌/模型档案驱动的 LLM 层,支持:
- 按品牌内置 thinking 开关(自动识别品牌 + 可手动覆盖)
- 每模型可配采样参数
- 自动重试 + 多模型 failover
- JSON Schema 结构化输出(不支持时自动降级)
- 现有 `boss-llm.json` 配置无感迁移

## 2. 关键决策(已与用户确认)

| 决策点 | 结论 |
|---|---|
| 范围 | 仅招聘端 |
| 额外能力 | 重试+failover、JSON Schema 输出(**不做**流式 UI、**不做**真实对话连通性测试,保留现有 GET `/models` 测试) |
| 配置迁移 | 自动无感迁移 |
| 品牌识别 | 自动识别 + 可手动覆盖 |
| 后端架构 | 品牌适配器注册表(方案 A) |
| 能力粒度 | **按"模型档案(model profile)"解析,品牌只给默认**(Codex review 修正) |

## 3. 后端架构

### 3.1 模块布局(全部新增,自包含)

```
packages/boss-auto-browse-and-chat/llm/
  brands/
    generic.mjs       # 默认/兜底:顶层 enable_thinking + thinking_budget(SiliconFlow 等)
    qwen.mjs          # DashScope/百炼
    deepseek.mjs      # api.deepseek.com(reasoner 模型名 + V4 thinking.type)
    glm.mjs           # 智谱 bigmodel
    openai.mjs        # OpenAI o系/GPT-5
    volc.mjs          # 火山方舟(单独建档,不与 SiliconFlow 混)
    index.mjs         # 注册表 + detectBrand({baseURL, modelId})
  profiles.mjs        # resolveModelProfile(brand, modelId) -> ModelProfile
  chat-complete.mjs   # chatComplete(model, messages, opts)
  failover.mjs        # chatCompleteForPurpose(config, purpose, messages, opts)
  errors.mjs          # 错误分类:isRetryable() / isFatal()
  usage.mjs           # 归一化 usage(prompt/completion/reasoning/cached tokens)
```

不修改 `packages/utils/gpt-request.mjs`(应聘端继续用,零回归)。招聘端各调用点改调用新层。

### 3.2 品牌适配器接口(纯函数,可单测)

```js
// brands/<brand>.mjs
export default {
  id: 'qwen',
  label: '通义千问 Qwen',
  match({ baseURL, modelId }) { /* 自动识别:域名 + model id 规则 */ return boolean },
  // 该品牌下的模型档案匹配表(按 model id 正则),从粗到细
  profiles: [
    { test: /qwq|-thinking$/i, profile: { /* 见 ModelProfile */ } },
    { test: /.*/,              profile: { /* 品牌默认档案 */ } }
  ]
}
```

### 3.3 模型档案 ModelProfile(能力下沉到这一层)

```js
{
  endpoint: 'chat' | 'responses',          // openai GPT-5+ 用 responses,其余 chat
  thinkingStyle:
    'top_level_enable' |                   // generic/SiliconFlow: enable_thinking + thinking_budget
    'qwen_enable' |                        // qwen: 顶层 enable_thinking + thinking_budget,thinking 时强制 stream 内部聚合
    'model_name' |                         // deepseek-reasoner: 由模型名决定
    'thinking_type' |                      // glm / deepseek-v4: thinking:{type:'enabled'|'disabled'}
    'reasoning_effort',                    // openai: reasoning_effort / reasoning.effort
  tokenLimitField: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens',
  unsupportedSampling: ['temperature','top_p','frequency_penalty','presence_penalty'] | [],
  structuredOutput: 'json_schema' | 'json_object' | 'none',
  requiresStreamForThinking: boolean,
  effortValues?: ['low','medium','high'],  // reasoning_effort 档位(随模型)
}
```

> **关键修正(Codex)**:`temperature`/`top_p`/penalties 的 strip、token 上限字段名、结构化输出级别都因**模型**而异(同品牌不同代不同),所以放在 ModelProfile 而非品牌层。

### 3.4 各品牌 / 档案的 thinking 写法(已据 Codex review 核对)

| 品牌 | thinking 开 | 关键约束 |
|---|---|---|
| **generic / SiliconFlow** | 顶层 `enable_thinking:true` + `thinking_budget`(128–32768) | 返回 `reasoning_content` + `reasoning_tokens` |
| **Qwen / DashScope** | Node openai SDK 用**顶层**字段 `enable_thinking`/`thinking_budget`(`extra_body` 是 Python 写法) | thinking 时**必须 stream**,适配器内部 stream + 聚合;`stream_options.include_usage` 取用量;按快照默认不同,生产固定快照 |
| **DeepSeek** | 两套:① `deepseek-reasoner`(模型名=开) ② V4 `thinking:{type}` / `reasoning_effort` | reasoner 忽略 temperature/top_p/penalties;**支持 JSON 输出**、不支持 function calling;`reasoning_content` 不能回传进输入(否则 400) |
| **GLM / 智谱** | `thinking:{ type:'enabled'\|'disabled' }`(字符串,非 bool) | GLM-4.5 默认动态思考 |
| **OpenAI o系/GPT-5** | 新集成优先 Responses API `reasoning:{effort}` + `max_output_tokens`;Chat 兼容用 `reasoning_effort` + `max_completion_tokens` | 不用 `max_tokens`;限制采样参数;effort 档位随模型(可含 none/minimal/low/medium/high/xhigh) |
| **火山方舟 Volc Ark** | 单独建档,按其文档确认字段 | 不与 SiliconFlow 混 |

### 3.5 chatComplete(单次调用)

`chatComplete(model, messages, { purpose, schema, sampling })`:
1. `brand = model.brand==='auto' ? detectBrand(model) : 品牌表[model.brand]`
2. `profile = resolveModelProfile(brand, model.model)`
3. `buildRequest`:套 thinkingStyle、按 `tokenLimitField` 放 token 上限、strip `unsupportedSampling`、按 `structuredOutput` 决定 schema 形态(json_schema→json_object→prompt-only 降级)
4. 若 `requiresStreamForThinking && thinking.enabled`:走 stream,聚合 `reasoning_content`+`content`,末 chunk 取 usage
5. 调 SDK(带 `AbortController` 超时 + 流空闲超时)
6. 归一化返回 `{ content, reasoning, usage:{prompt,completion,reasoning,cached,total}, raw }`

### 3.6 failover + retry

`chatCompleteForPurpose(config, purpose, messages, opts)`:
1. 解析该用途的有序模型链(`purposes[purpose].modelIds`;空→全局启用模型顺序)
2. 逐模型尝试;每模型最多 `retry.maxAttemptsPerModel` 次,指数退避 `retry.backoffMs`
3. **每个目标模型重建请求体**(品牌不同,thinking/token/schema 都不同)
4. 错误分类(`errors.mjs`):
   - **重试**:429、5xx、网络重置、流超时
   - **直接失败换下一个**:鉴权、额度、不支持参数、不支持 schema/tool、超长、请求格式错误
5. 全链失败 → 抛出聚合错误(含每个模型的失败原因)

## 4. 配置 Schema(`boss-llm.json` version 2)

```jsonc
{
  "version": 2,
  "providers": [{
    "id": "uuid", "name": "硅基流动", "baseURL": "https://api.siliconflow.cn/v1", "apiKey": "sk-…",
    "models": [{
      "id": "uuid", "name": "R1 简历筛选", "model": "Pro/deepseek-ai/DeepSeek-R1", "enabled": true,
      "brand": "auto",                                   // auto | qwen | deepseek | glm | openai | volc | generic
      "thinking": { "enabled": true, "budget": 2048, "effort": "medium" },
      "sampling": { "temperature": null, "max_tokens": null, "top_p": null,
                    "frequency_penalty": null, "presence_penalty": null }  // null=不传
    }]
  }],
  "purposes": {
    "resume_screening":   { "modelIds": [] },
    "rubric_generation":  { "modelIds": [] },
    "greeting_generation":{ "modelIds": [] },
    "message_rewrite":    { "modelIds": [] },
    "default":            { "modelIds": [] }
  },
  "retry": { "maxAttemptsPerModel": 2, "backoffMs": 500 }
}
```

### 迁移(读取时跑一次,幂等,出错不致命)

- 旧 `providers[]` → 每个 model 补 `brand:'auto'`、`sampling:{全 null}`、补全 `thinking.effort`。
- 更旧 flat `models[]` → 已有 `migrateFlatModelsToProviders` 转 providers,再同上。
- 旧 `purposeDefaultModelId[p]` → `purposes[p].modelIds = [那个 id]`。
- 补 `version:2`、`retry` 默认值。

## 5. 配置 UI(三个标签页)

页面 = `BossLlmConfig`,改为 Tab 布局:

### Tab 1「模型」— 按服务商分组
- 服务商卡(可折叠):`name` / `baseURL` / `apiKey` / [测试连接(沿用 GET /models)] / [+ 在此服务商下加模型]
- 模型卡(展开态):
  - 头:[启用开关] [别名] [删除]
  - `Model ID`
  - **品牌行**:`自动识别 → DeepSeek` 徽章 + 下拉(跟随自动 / 锁定某品牌)
  - **Thinking 控件随识别品牌变形态**:
    - budget 类(Qwen/generic/GLM):`☑启用` + token 数字框
    - effort 类(OpenAI):`☑启用` + 低/中/高(随模型档位)
    - model_name 类(DeepSeek reasoner):提示"由模型名决定"
  - **高级参数**(可折叠,留空=自动):temperature / max_tokens / top_p / frequency_penalty / presence_penalty
- [+ 添加服务商]

### Tab 2「用途分配」
- 5 个用途各一条**有序 failover 链**:模型 chip 可拖拽排序、删除,[+ 添加模型]
- 空 = "跟随全局启用顺序"兜底

### Tab 3「通用」
- retry 设置:`maxAttemptsPerModel`、`backoffMs`

### IPC
- 复用 `boss-fetch-llm-config` / `boss-save-llm-config` / `boss-test-llm-endpoint`(返回结构按新 schema)。

## 6. 消费方接入

招聘端现有 3 个调用点改为走新层 `chatCompleteForPurpose(config, purpose, messages, { schema })`:

| 函数 | 文件 | purpose | schema |
|---|---|---|---|
| `evaluateResumeByRubric` | `llm-rubric.mjs` | resume_screening | rubric 评分 JSON Schema |
| `generateRubricFromJd` | `llm-rubric.mjs` | rubric_generation | rubric 生成 JSON Schema |
| `screenCandidateWithLlm` | `chat-page-processor.mjs` | resume_screening | pass/reason JSON Schema |

`recommend/scorer.mjs` 的 `defaultLlm` 经 `evaluateResumeByRubric` 间接受益。各调用点原先写死的 `max_tokens` 改为按用途默认值或显式 override。`getEnabledLlmClient` 被 failover 链解析取代。

## 7. 测试策略

- **品牌适配器/档案**(纯函数):各品牌 `buildRequest` 正确套 thinking、strip 参数、选 token 字段、降级 schema —— 单测。
- **detectBrand / resolveModelProfile**:典型 baseURL+model id → 正确品牌+档案。
- **failover**:mock chatComplete,验证重试次数、错误分类(retry vs fatal)、切模型重建请求、全失败聚合。
- **迁移**:旧 providers[] / flat models[] / purposeDefaultModelId → 新 schema 快照测试。
- **usage 归一化**:含 reasoning/cached tokens。
- 测试随 `.mjs` 放在各模块旁(沿用现有 `*.test.mjs` 习惯)。

## 8. 非目标(本次不做)

- 流式输出 UI / 展示推理过程(仅 Qwen 内部为满足约束而流式聚合,对外透明)
- 真实对话连通性测试(保留现有 GET `/models`)
- 应聘端改造、`packages/utils/gpt-request.mjs` 改动
- 成本/用量持久化看板(usage 已归一化返回,持久化看板留待以后)

## 9. 风险与待确认

- **火山方舟字段**未最终核实,实现时按其官方文档确认 `volc.mjs`(Codex 标注低置信)。
- **OpenAI Responses API**:若 GPT-5 兼容路径行为不稳,优先 Responses;Chat 兼容作为回退。
- **Qwen 流式聚合**:需处理空 choice 末 chunk、流中断(部分结果、用量不确定)。
- **快照固定**:建议预设模板里用固定快照而非 `-latest`,避免默认静默变化。
