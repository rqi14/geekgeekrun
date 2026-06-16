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
| 能力粒度 | **两轴解析:provider dialect(看 baseURL/endpoint,决定线格式)× model family(看 model id,决定能力)**,合并成 ModelProfile(Codex review 修正) |

## 3. 后端架构

### 3.1 模块布局(全部新增,自包含)

```
packages/boss-auto-browse-and-chat/llm/
  dialects/             # provider dialect:线格式,按 baseURL/endpoint 选
    generic.mjs         # 默认/兜底:顶层 enable_thinking + thinking_budget(SiliconFlow 等 OpenAI 兼容代理)
    qwen.mjs            # DashScope/百炼
    deepseek.mjs        # api.deepseek.com 直连(reasoner 模型名 + V4 thinking.type)
    glm.mjs             # 智谱 bigmodel
    openai-chat.mjs     # OpenAI Chat Completions 兼容
    openai-responses.mjs# OpenAI Responses API(GPT-5/o系优先)
    volc.mjs            # 火山方舟(单独建档,不与 SiliconFlow 混)
    index.mjs           # 注册表 + resolveDialect({baseURL, brandLock, endpoint, family})
                        #   openai 族:endpoint='auto' 时由 family 选 chat/responses;'chat'/'responses' 则锁定
  families.mjs          # resolveModelFamily(modelId) -> 能力标志(是否推理模型/JSON 支持/采样限制)
  profiles.mjs          # resolveModelProfile({dialect, family, userOverrides}) -> ModelProfile
  chat-complete.mjs     # chatComplete(model, messages, opts)
  failover.mjs          # chatCompleteForPurpose(config, purpose, messages, opts)
  errors.mjs            # 错误分类:classifyError(err) -> {kind, action, retryAfterMs}(契约见 §3.6)
  schema-validate.mjs   # 结构化输出:本地 JSON.parse + schema 校验 + 降级
  usage.mjs             # 归一化 usage(prompt/completion/reasoning/cached tokens)
```

不修改 `packages/utils/gpt-request.mjs`(应聘端继续用,零回归)。招聘端各调用点改调用新层。

### 3.2 两轴解析:provider dialect × model family(关键修正,Codex #3)

线格式(thinking 字段怎么写、token 上限字段名、结构化输出 builder)由**你实际在对话的那个 API** 决定 = **provider dialect**(看 `baseURL`/endpoint)。模型有没有推理、是否支持 JSON Schema、是否忽略采样参数 = **model family**(看 `model id`)。两者正交:

- **典型坑**:SiliconFlow 托管 `Pro/deepseek-ai/DeepSeek-R1`。dialect = `generic`(SiliconFlow 用顶层 `enable_thinking`),family = `deepseek-reasoner`(能力:推理模型、忽略采样、支持 JSON object)。**绝不能**因为 model id 含 deepseek 就套 api.deepseek.com 的 reasoner 线格式。
- 直连 `api.deepseek.com` 时:dialect = `deepseek`(reasoner 模型名 / V4 thinking.type),family 同上。

```js
// dialects/<dialect>.mjs(纯函数,可单测)
export default {
  id: 'qwen',
  label: '通义千问 Qwen',
  match({ baseURL, endpoint }) { /* 仅看 baseURL / endpoint 锁定 */ return boolean },
  buildRequest({ family, thinking, sampling, schema, messages, tokenLimit }) { /* 套本 dialect 线格式 */ },
  buildStructuredOutput({ schema, family }) { /* dialect 专属:Chat 用 response_format,Responses 用 text.format(Codex #5) */ },
  parseResponse(raw) { /* 归一化 content/reasoning/usage */ }
}
```

```js
// families.mjs:resolveModelFamily(modelId) ->
{
  isReasoningModel: boolean,           // 由 model id 推断(qwq / -thinking / reasoner / o\d / gpt-5 …)
  ignoresSampling: ['temperature','top_p','frequency_penalty','presence_penalty'] | [],
  structuredOutputCap: 'json_schema' | 'json_object' | 'none',  // 该模型最高支持级别
  effortValues?: string[]  // 仅 reasoning_effort 类;该模型官方文档列出的档位有序数组,内容随模型(常见 ['low','medium','high'],部分模型含 'minimal')。UI 按此数组渲染档位,不写死(Codex #1/#2)
}
```

### 3.3 模型档案 ModelProfile(dialect + family + 用户覆盖 合并结果)

`resolveModelProfile({dialect, family, userOverrides})` 合并出最终档案:

```js
{
  dialectId: 'generic' | 'qwen' | 'deepseek' | 'glm' | 'openai-chat' | 'openai-responses' | 'volc',
  endpoint: 'chat' | 'responses',
  thinkingStyle:
    'top_level_enable' |                   // generic/SiliconFlow: enable_thinking + thinking_budget
    'qwen_enable' |                        // qwen: 顶层 enable_thinking + thinking_budget,thinking 时强制 stream 内部聚合
    'model_name' |                         // deepseek 直连 reasoner: 由模型名决定
    'thinking_type' |                      // glm / deepseek-v4 直连: thinking:{type:'enabled'|'disabled'}
    'reasoning_effort',                    // openai 专属: reasoning_effort(chat) / reasoning.effort(responses)
  tokenLimitField: 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens',  // 由 dialect/endpoint 定
  unsupportedSampling: [...],             // = family.ignoresSampling ∪ dialect 限制
  structuredOutput: 'json_schema' | 'json_object' | 'none',  // = min(dialect 能力, family.structuredOutputCap)
  requiresStreamForThinking: boolean,     // dialect 定(qwen=true)
  effortValues?: string[],                // = family.effortValues(随模型,可能含 'minimal')
}
```

> **关键修正(Codex #3)**:thinking 线格式跟 **dialect(API endpoint)**,能力跟 **family(model id)**。两者分开解析再合并,避免「SiliconFlow 托管的 DeepSeek 套错线格式」。

### 3.4 各 dialect 的 thinking 写法(已据 Codex review 核对)

| dialect | thinking 开 | 关键约束 |
|---|---|---|
| **generic / SiliconFlow** | 顶层 `enable_thinking:true` + `thinking_budget`(128–32768) | 返回 `reasoning_content` + `reasoning_tokens`;SiliconFlow 托管的 DeepSeek/Qwen 也走这套(**不**用各家直连写法) |
| **Qwen / DashScope** | Node openai SDK 用**顶层**字段 `enable_thinking`/`thinking_budget`(`extra_body` 是 Python 写法) | thinking 时**必须 stream**,适配器内部 stream + 聚合;`stream_options.include_usage` 取用量;生产固定快照,不用 `-latest` |
| **DeepSeek 直连** | 两套:① `deepseek-reasoner`(模型名=开) ② V4 `thinking:{type:'enabled'\|'disabled'}`(本项目对 V4 **统一只用 thinking_type**;DeepSeek API 亦提供 `reasoning_effort`,但为单一代码路径不采用,避免与 thinking_type 同发,Codex #2) | reasoner 忽略 temperature/top_p/penalties;**支持 JSON 输出**、不支持 function calling;`reasoning_content` 不能回传进输入(否则 400) |
| **GLM / 智谱** | `thinking:{ type:'enabled'\|'disabled' }`(字符串,非 bool) | GLM-4.5 默认动态思考 |
| **OpenAI o系/GPT-5** | 优先 Responses API `reasoning:{effort}` + `max_output_tokens`;Chat 兼容用 `reasoning_effort` + `max_completion_tokens` | 不用 `max_tokens`;限制采样参数;effort 档位 = `low`/`medium`/`high`,`minimal` 仅在当前 OpenAI 官方文档明确列出该模型支持时才提供;不引入官方文档未列出的档位(Codex #1) |
| **火山方舟 Volc Ark** | 单独建档,按其文档确认字段 | 不与 SiliconFlow 混 |

### 3.5 chatComplete(单次调用)

`chatComplete(model, messages, { purpose, schema, sampling })`(`model` 是已 hydrate 的「provider+model 合并对象」,携带 `baseURL`/`apiKey`/`model`/`brand`/`endpoint`/`thinking`/`sampling`):
1. `family = resolveModelFamily(model.model)`(先解析 family,供下一步用)
2. `dialect = resolveDialect({baseURL: model.baseURL, brandLock: model.brand, endpoint: model.endpoint, family})`(`brand!=='auto'` **只锁定 dialect / provider 适配器**,model family 仍由步骤 1 的 `resolveModelFamily(model.model)` 解析,两者正交;openai 适配器组再按 `endpoint`(auto→由 family 选 chat/responses)定具体 dialect);`profile = resolveModelProfile({dialect, family, userOverrides})`
3. `dialect.buildRequest`:套 thinkingStyle、按 `tokenLimitField` 放 token 上限、strip `unsupportedSampling`、用 **endpoint 专属** structured-output builder(Chat=`response_format`,Responses=`text.format`,Codex #5),按 `structuredOutput` 级别降级(json_schema→json_object→prompt-only)
4. 若 `requiresStreamForThinking && thinking.enabled`:走 stream,聚合 `reasoning_content`+`content`,末 chunk 取 usage
5. 调 SDK(带 `AbortController` 总超时 + 流空闲超时)
6. **若请求了 schema**:对返回 content 本地 `JSON.parse` + schema 校验(`schema-validate.mjs`);失败则按降级链重试(json_schema→json_object→prompt-only),仍失败则交由 failover 视为该模型失败(Codex #7)
7. 归一化返回 `{ content, parsed?, reasoning, usage:{prompt,completion,reasoning,cached,total}, raw }`。`raw` **仅进程内使用**(调试),**绝不**经 IPC 回传渲染端、也不原样落日志;若需记录只记脱敏后的 usage/状态。

### 3.6 failover + retry

`chatCompleteForPurpose(config, purpose, messages, opts)`:
1. 解析该用途的有序模型链(`purposes[purpose].modelIds`;空→全局启用模型顺序)
2. 逐模型尝试;每模型最多 `retry.maxAttemptsPerModel` 次,指数退避 `retry.backoffMs` + **抖动 jitter**(Codex #4)
3. **每个目标模型重建请求体**(dialect 不同,thinking/token/schema 都不同)
4. **错误分类驱动状态机**:`classifyError(err)` 看 HTTP status + provider 错误 body/code,返回稳定契约 `{ kind, action, retryAfterMs? }`。`action` 唯一决定下一步:

   | `kind` | 触发场景 | `action` | 行为 |
   |---|---|---|---|
   | `rate_limit` | 429 限流 | `retry_same` | 退避后重试同模型;有 `Retry-After` 则遵守,封顶 `retry.maxBackoffMs` |
   | `server` / `network` / `stream_timeout` | 5xx / ECONNRESET / 流空闲超时 | `retry_same` | 指数退避 + jitter 重试同模型 |
   | `endpoint_unavailable` | `/responses` 404、模型不在该 route | `endpoint_downgrade` | openai 且 `endpoint:'auto'`→responses 时,同模型预算内改用 `openai-chat` 重发一次;endpoint 显式锁定时退化为 `next_model` |
   | `unsupported_schema` | 请求时拒绝 `response_format`/`text.format`/schema | `schema_downgrade` | 按 §3.5 降级链(json_schema→json_object→prompt-only)**同模型**重发;降到底仍失败才 `next_model` |
   | `auth` / `quota` / `unsupported_param` / `context_overflow` / `bad_request` | 鉴权失效、额度欠费(`insufficient_balance`,与限流区分)、不支持参数、超长、格式错误 | `next_model` | 不重试本模型,直接换链上下一个 |
   | `unknown` | 兜底 | `next_model` | 保守换下一个 |

   - 每模型 `retry_same` 最多 `retry.maxAttemptsPerModel` 次;`endpoint_downgrade` / `schema_downgrade` 在同模型预算内**最多各发生一次**。
   - 整条 failover 受 `retry.totalDeadlineMs` 总超时约束,超时即放弃后续模型(防止超大 `Retry-After` 拖死招聘流程)。
5. 全链失败 → 抛出聚合错误(含每个模型的 `kind` + 脱敏原因)
6. **密钥脱敏(Codex)**:写日志、IPC 返回、聚合错误前,统一经 `redact()` 抹去 `apiKey`、`Authorization` 头、请求体与 provider 错误 payload 中的密钥(只保留前后各 4 位掩码)。错误对象不得携带原始 header/body。

## 4. 配置 Schema(`boss-llm.json` version 2)

```jsonc
{
  "version": 2,
  "providers": [{
    "id": "uuid", "name": "硅基流动", "baseURL": "https://api.siliconflow.cn/v1", "apiKey": "sk-…",
    "models": [{
      "id": "uuid", "name": "R1 简历筛选", "model": "Pro/deepseek-ai/DeepSeek-R1", "enabled": true,
      "brand": "auto",                                   // auto | qwen | deepseek | glm | openai | volc | generic;只锁定 dialect/provider 适配器,model family 仍按 model id 解析
      "endpoint": "auto",                                // auto | chat | responses;仅 openai 有意义。auto=按模型族解析(推理模型→responses,否则 chat);auto 时遇 route 不可用按 §3.6 内部降级到 chat
      "thinking": { "enabled": true, "budget": 2048, "effort": "medium" },  // budget 仅 budget 类用;effort 仅 openai 用(字符串,取值见 profile.effortValues)
      "sampling": { "temperature": null, "max_tokens": null, "top_p": null,
                    "frequency_penalty": null, "presence_penalty": null }  // null=不传
    }]
  }],
  "purposes": {
    "resume_screening":   { "modelIds": [] },
    "rubric_generation":  { "modelIds": [] },
    "greeting_generation":{ "modelIds": [] },   // 预留:暂无消费方,未配置时回落 default
    "message_rewrite":    { "modelIds": [] },   // 预留:暂无消费方,未配置时回落 default
    "default":            { "modelIds": [] }
  },
  "retry": { "maxAttemptsPerModel": 2, "backoffMs": 500, "maxBackoffMs": 20000, "totalDeadlineMs": 120000 }
}
```

### 迁移(读取时跑一次,幂等,出错不致命)

- 旧 `providers[]` → 每个 model 补 `brand:'auto'`、`sampling:{全 null}`、补全 `thinking.effort`。
- 更旧 flat `models[]` → 已有 `migrateFlatModelsToProviders` 转 providers,再同上。
- 旧 `purposeDefaultModelId[p]` → `purposes[p].modelIds = [那个 id]`。
- 补 `version:2`、`retry` 默认值。

**持久化硬化(Codex #6)**:
- **严格 JSON**:读用 `JSON.parse`(不用 JSON5),解析失败 → 不静默丢弃,改用 `.bak` 备份原文件后再写默认值。
- **schema 校验**:读取后校验形状;非法字段记日志但**保留未知字段**(unknown-field preservation,向前兼容更新版本写的配置)。
- **原子写**:写临时文件 → `fsync` → `rename` 覆盖,避免半截文件。
- **写前自动备份**:迁移落盘前先把旧文件复制为 `boss-llm.json.bak`,迁移异常可回滚。

## 5. 配置 UI(三个标签页)

页面 = `BossLlmConfig`,改为 Tab 布局:

### Tab 1「模型」— 按服务商分组
- 服务商卡(可折叠):`name` / `baseURL` / `apiKey` / [测试连接(沿用 GET /models)] / [+ 在此服务商下加模型]
- 模型卡(展开态):
  - 头:[启用开关] [别名] [删除]
  - `Model ID`
  - **品牌行**:`自动识别 → DeepSeek` 徽章 + 下拉(跟随自动 / 锁定某品牌)
  - **Thinking 控件随识别 dialect/profile 变形态**(由 `thinkingStyle` 决定):
    - budget 类(`top_level_enable`/`qwen_enable`,即 Qwen/generic):`☑启用` + token 预算数字框
    - toggle 类(`thinking_type`,即 GLM / DeepSeek V4 直连):`☑启用` 开关,**无** token 预算框(该写法只有 `type:enabled|disabled`)
    - effort 类(`reasoning_effort`,即 OpenAI):`☑启用` + 档位单选,**按 profile 的 `effortValues` 动态渲染**(可能是 minimal/low/medium/high 的子集,不写死)
    - model_name 类(DeepSeek reasoner 直连):只读提示"由模型名决定"
  - **Endpoint 选择**(仅当识别/锁定为 OpenAI 族时显示):`自动 / Chat / Responses` 下拉(对应 `endpoint` 字段;自动=按模型族)
  - **高级参数**(可折叠,留空=自动):temperature / max_tokens / top_p / frequency_penalty / presence_penalty
- [+ 添加服务商]

### Tab 2「用途分配」
- 5 个用途各一条**有序 failover 链**:模型 chip 可拖拽排序、删除,[+ 添加模型]
- 空 = "跟随全局启用顺序"兜底

### Tab 3「通用」
- retry 设置:`maxAttemptsPerModel`、`backoffMs`、`maxBackoffMs`、`totalDeadlineMs`

### IPC
- 复用 `boss-fetch-llm-config` / `boss-save-llm-config` / `boss-test-llm-endpoint`(返回结构按新 schema)。

## 6. 消费方接入

招聘端现有 3 个调用点改为走新层 `chatCompleteForPurpose(config, purpose, messages, { schema })`:

| 函数 | 文件 | purpose | schema |
|---|---|---|---|
| `evaluateResumeByRubric` | `llm-rubric.mjs` | resume_screening | rubric 评分 JSON Schema |
| `generateRubricFromJd` | `llm-rubric.mjs` | rubric_generation | rubric 生成 JSON Schema |
| `screenCandidateWithLlm` | `chat-page-processor.mjs` | resume_screening | pass/reason JSON Schema |

`recommend/scorer.mjs` 的 `defaultLlm` 经 `evaluateResumeByRubric` 间接受益。`getEnabledLlmClient` 被 failover 链解析取代。

各调用点原先写死的 `max_tokens` 改为**消费层代码常量**(每用途一个默认 token 上限,如 resume_screening≈500、rubric_generation≈2000),作为 `chatCompleteForPurpose(..., { maxOutputTokens })` 显式传入;模型卡上的 `sampling.max_tokens`(用户填写)若非空则覆盖该默认。**不**在 schema 里新增 per-purpose token 字段(YAGNI)。

> `greeting_generation` / `message_rewrite` 为**预留用途**:本次无对应调用点,UI 中可配但运行时这两个用途未被消费;待相应功能落地时再接线。未单独配置的用途(含这两者)运行时回落到 `default` 链。

## 7. 测试策略

- **dialect.buildRequest**(纯函数):各 dialect 正确套 thinking、strip 参数、选 token 字段;OpenAI Chat 用 `response_format`、Responses 用 `text.format`;DeepSeek V4 只发 `thinking.type`、绝不发 `reasoning_effort` —— 单测。
- **resolveDialect / resolveModelFamily / resolveModelProfile**:重点 cover「SiliconFlow 托管 DeepSeek-R1」→ dialect=generic、family=deepseek-reasoner 的组合;OpenAI effort 档位仅取当前官方文档列出的值(`low`/`medium`/`high`,`minimal` 仅在官方文档明确支持该模型时)。
- **schema-validate**:合法 JSON 通过、非法触发降级链(json_schema→json_object→prompt-only)、最终失败上抛。
- **failover**:mock chatComplete,验证重试次数、`classifyError` 的 `{kind,action}` 映射(限流→retry_same / 额度→next_model / 鉴权→next_model)、`Retry-After` 遵守且被 `maxBackoffMs` 封顶、`totalDeadlineMs` 到点放弃后续模型、jitter 存在、切模型重建请求、全失败聚合(只含脱敏原因)。
- **endpoint 降级**:openai `endpoint:'auto'`→responses 遇 `endpoint_unavailable` 时,同模型内降级 `openai-chat` 一次;显式锁定 endpoint 时不降级直接换模型。
- **schema 降级**:请求时 `unsupported_schema` 触发 json_schema→json_object→prompt-only 同模型重发;降到底才换模型(区别于「post-response 校验失败」路径)。
- **迁移 + 持久化**:旧 providers[] / flat models[] / purposeDefaultModelId → 新 schema 快照测试;坏 JSON → 备份+默认;未知字段保留;原子写。
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
