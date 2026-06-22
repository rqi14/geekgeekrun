<template>
  <div class="boss-llm-config__wrap">
    <div class="page-header">
      <div class="page-title">招聘端大语言模型配置</div>
      <div class="page-desc">
        为不同 API 服务商配置模型，内置各品牌 thinking 开关与自动重试 / 多模型 failover。配置保存到
        <code>boss-llm.json</code>（v2）。
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <!-- ── Tab 1：模型 ───────────────────────────────────────────── -->
      <el-tab-pane label="模型" name="models">
        <div v-if="providers.length" class="provider-list">
          <el-card v-for="(p, pIdx) in providers" :key="p.id" class="provider-card" shadow="hover">
            <div class="provider-header">
              <div class="provider-header-left">
                <el-input
                  v-model="p.name"
                  placeholder="服务商名称（例如：SiliconFlow）"
                  class="provider-name-input"
                  size="small"
                />
              </div>
              <el-button size="small" type="danger" text @click="removeProvider(pIdx)">
                删除服务商
              </el-button>
            </div>

            <div class="form-row-2 provider-conn">
              <el-form-item label="API Base URL">
                <el-input
                  v-model="p.baseURL"
                  placeholder="https://api.siliconflow.cn/v1"
                  @blur="detectProviderModels(p)"
                />
              </el-form-item>
              <el-form-item label="API Key">
                <el-input v-model="p.apiKey" type="password" show-password placeholder="sk-xxx" />
              </el-form-item>
            </div>

            <div class="model-list">
              <div v-for="(m, mIdx) in p.models" :key="m.id" class="model-row">
                <div class="model-row-header">
                  <el-switch v-model="m.enabled" style="flex-shrink: 0" />
                  <el-input
                    v-model="m.name"
                    placeholder="模型别名（例如：DeepSeek-R1 简历筛选）"
                    class="model-name-input"
                    size="small"
                  />
                  <el-button size="small" :loading="m._testing" @click="handleTestEndpoint(p, m)">
                    测试连接
                  </el-button>
                  <el-button size="small" type="danger" text @click="removeModel(pIdx, mIdx)">
                    删除
                  </el-button>
                </div>

                <el-form-item label="Model ID" class="model-id-item">
                  <el-input
                    v-model="m.model"
                    placeholder="Pro/deepseek-ai/DeepSeek-R1"
                    @blur="detectBrand(p, m)"
                  />
                </el-form-item>

                <div class="inline-row">
                  <span class="inline-label">品牌</span>
                  <el-tag v-if="m.brand === 'auto' && detected[m.id]" size="small" type="info">
                    自动识别 → {{ detected[m.id].label }}
                  </el-tag>
                  <el-select
                    v-model="m.brand"
                    size="small"
                    style="width: 150px"
                    @change="detectBrand(p, m)"
                  >
                    <el-option
                      v-for="b in BRAND_OPTIONS"
                      :key="b.value"
                      :label="b.label"
                      :value="b.value"
                    />
                  </el-select>
                </div>

                <div v-if="isOpenAi(m)" class="inline-row">
                  <span class="inline-label">Endpoint</span>
                  <el-select
                    v-model="m.endpoint"
                    size="small"
                    style="width: 150px"
                    @change="detectBrand(p, m)"
                  >
                    <el-option label="自动" value="auto" />
                    <el-option label="Chat" value="chat" />
                    <el-option label="Responses" value="responses" />
                  </el-select>
                </div>

                <div class="inline-row">
                  <span class="inline-label">Thinking</span>
                  <template v-if="thinkingKind(m) === 'budget'">
                    <el-checkbox v-model="m.thinking.enabled">启用</el-checkbox>
                    <el-input-number
                      v-if="m.thinking.enabled"
                      v-model="m.thinking.budget"
                      :min="128"
                      :max="32768"
                      :step="512"
                      controls-position="right"
                      style="width: 130px"
                    />
                    <span v-if="m.thinking.enabled" class="form-tip">Token 预算</span>
                  </template>
                  <template v-else-if="thinkingKind(m) === 'toggle'">
                    <el-checkbox v-model="m.thinking.enabled">启用</el-checkbox>
                  </template>
                  <template v-else-if="thinkingKind(m) === 'effort'">
                    <el-checkbox v-model="m.thinking.enabled">启用</el-checkbox>
                    <el-radio-group
                      v-if="m.thinking.enabled"
                      v-model="m.thinking.effort"
                      size="small"
                    >
                      <el-radio-button v-for="ev in effortValues(m)" :key="ev" :value="ev">
                        {{ ev }}
                      </el-radio-button>
                    </el-radio-group>
                  </template>
                  <template v-else-if="thinkingKind(m) === 'model_name'">
                    <span class="form-tip">由模型名决定（如 deepseek-reasoner）</span>
                  </template>
                  <template v-else>
                    <span class="form-tip">该模型无思考能力</span>
                  </template>
                </div>

                <el-collapse class="advanced">
                  <el-collapse-item title="高级参数（留空 = 自动 / 品牌默认）">
                    <div class="sampling-grid">
                      <div>
                        <div class="sampling-label">temperature</div>
                        <el-input-number
                          v-model="m.sampling.temperature"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          style="width: 100%"
                        />
                      </div>
                      <div>
                        <div class="sampling-label">max_tokens</div>
                        <el-input-number
                          v-model="m.sampling.max_tokens"
                          :min="1"
                          controls-position="right"
                          style="width: 100%"
                        />
                      </div>
                      <div>
                        <div class="sampling-label">top_p</div>
                        <el-input-number
                          v-model="m.sampling.top_p"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          style="width: 100%"
                        />
                      </div>
                      <div>
                        <div class="sampling-label">frequency_penalty</div>
                        <el-input-number
                          v-model="m.sampling.frequency_penalty"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          style="width: 100%"
                        />
                      </div>
                      <div>
                        <div class="sampling-label">presence_penalty</div>
                        <el-input-number
                          v-model="m.sampling.presence_penalty"
                          :precision="2"
                          :step="0.1"
                          controls-position="right"
                          style="width: 100%"
                        />
                      </div>
                    </div>
                  </el-collapse-item>
                </el-collapse>

                <el-alert
                  v-if="m._testResult"
                  :type="m._testResult.ok ? 'success' : 'error'"
                  :title="m._testResult.ok ? '连接成功' : `连接失败：${m._testResult.error}`"
                  show-icon
                  :closable="false"
                  style="margin-top: 8px"
                />
              </div>
            </div>

            <div class="add-model-bar">
              <el-button size="small" plain @click="addModel(pIdx)">+ 添加模型</el-button>
            </div>
          </el-card>
        </div>

        <el-empty v-else description="暂无服务商，请添加" />

        <div class="add-provider-bar">
          <el-button type="primary" plain @click="addProvider">+ 添加服务商</el-button>
          <el-dropdown @command="addPreset">
            <el-button plain>
              从预设添加 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="preset in presets" :key="preset.name" :command="preset">
                  {{ preset.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-tab-pane>

      <!-- ── Tab 2：用途分配 ───────────────────────────────────────── -->
      <el-tab-pane label="用途分配" name="purposes">
        <div class="section-desc">
          每个用途按所选模型顺序 failover。留空 = 回落「默认」链，默认也空 = 跟随全局启用顺序。
        </div>
        <el-alert
          v-if="!isLoading && allEnabledModels.length === 0"
          type="info"
          show-icon
          :closable="false"
          title="尚未添加任何启用的模型，请先在「模型」标签页添加"
          style="margin-bottom: 14px"
        />
        <el-form label-position="top">
          <el-form-item v-for="purpose in PURPOSE_LIST" :key="purpose.key" :label="purpose.label">
            <el-select
              v-model="purposeChains[purpose.key].modelIds"
              multiple
              filterable
              placeholder="（留空 = 回落默认 / 全局启用顺序）"
              style="width: 100%"
            >
              <el-option
                v-for="m in allEnabledModels"
                :key="m.id"
                :label="m.displayName"
                :value="m.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- ── Tab 3：通用 ───────────────────────────────────────────── -->
      <el-tab-pane label="通用" name="general">
        <el-form label-width="200px" style="max-width: 460px">
          <el-form-item label="每模型最大重试次数">
            <el-input-number
              v-model="retry.maxAttemptsPerModel"
              :min="0"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="退避基数 (ms)">
            <el-input-number
              v-model="retry.backoffMs"
              :min="0"
              :step="100"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="退避上限 (ms)">
            <el-input-number
              v-model="retry.maxBackoffMs"
              :min="0"
              :step="1000"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item label="总超时 (ms)">
            <el-input-number
              v-model="retry.totalDeadlineMs"
              :min="0"
              :step="1000"
              controls-position="right"
            />
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <div class="action-bar">
      <el-button :loading="isSaving" type="primary" @click="handleSave">保存配置</el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

const { ipcRenderer } = electron

// ── 类型 ─────────────────────────────────────────────────────────────────────
interface ThinkingConfig {
  enabled: boolean
  budget: number
  effort: string
}
interface SamplingConfig {
  temperature: number | null
  max_tokens: number | null
  top_p: number | null
  frequency_penalty: number | null
  presence_penalty: number | null
}
interface ModelEntry {
  id: string
  name: string
  model: string
  enabled: boolean
  brand: string
  endpoint: string
  thinking: ThinkingConfig
  sampling: SamplingConfig
  _testing?: boolean
  _testResult?: { ok: boolean; error?: string } | null
}
interface ProviderEntry {
  id: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelEntry[]
}
interface DetectResult {
  dialectId: string
  label: string
  isReasoningModel: boolean
  effortValues: string[] | null
  thinkingStyle: string
}

// ── 常量 ─────────────────────────────────────────────────────────────────────
const BRAND_OPTIONS = [
  { value: 'auto', label: '自动识别' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: 'GLM' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'generic', label: '通用兼容' }
]
const PURPOSE_LIST = [
  { key: 'resume_screening', label: '简历筛选' },
  { key: 'rubric_generation', label: '评分标准生成' },
  { key: 'greeting_generation', label: '招呼语生成（预留）' },
  { key: 'message_rewrite', label: '消息续写（预留）' },
  { key: 'default', label: '默认' }
]

// ── 状态（purposeChains 在 setup 即用全部 key 初始化，避免标签页 eager render 时取 undefined）──
const activeTab = ref('models')
const providers = ref<ProviderEntry[]>([])
const purposeChains = reactive<Record<string, { modelIds: string[] }>>(
  Object.fromEntries(PURPOSE_LIST.map((p) => [p.key, { modelIds: [] }]))
)
const retry = reactive({
  maxAttemptsPerModel: 2,
  backoffMs: 500,
  maxBackoffMs: 20000,
  totalDeadlineMs: 120000
})
const detected = reactive<Record<string, DetectResult>>({})
const isSaving = ref(false)
const isLoading = ref(true)

const allEnabledModels = computed(() =>
  providers.value.flatMap((p) =>
    p.models
      .filter((m) => m.enabled)
      .map((m) => ({
        id: m.id,
        displayName: `${p.name ? p.name + ' / ' : ''}${m.name || m.model}`
      }))
  )
)

// ── 预设模板 ─────────────────────────────────────────────────────────────────
const presets = [
  {
    name: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    models: [
      { name: 'DeepSeek-R1', model: 'Pro/deepseek-ai/DeepSeek-R1', thinking: { enabled: true } },
      { name: 'DeepSeek-V3', model: 'Pro/deepseek-ai/DeepSeek-V3', thinking: { enabled: false } }
    ]
  },
  {
    name: 'DeepSeek 官方',
    baseURL: 'https://api.deepseek.com/v1',
    models: [
      { name: 'DeepSeek-R1', model: 'deepseek-reasoner', thinking: { enabled: false } },
      { name: 'DeepSeek-V3', model: 'deepseek-chat', thinking: { enabled: false } }
    ]
  },
  {
    name: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ name: 'Qwen-Plus', model: 'qwen-plus', thinking: { enabled: false } }]
  }
]

// ── 工厂 ─────────────────────────────────────────────────────────────────────
function newThinking(overrides: Partial<ThinkingConfig> = {}): ThinkingConfig {
  return { enabled: false, budget: 2048, effort: 'medium', ...overrides }
}
function newSampling(overrides: Partial<SamplingConfig> = {}): SamplingConfig {
  return {
    temperature: null,
    max_tokens: null,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    ...overrides
  }
}
function newModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: crypto.randomUUID(),
    name: '',
    model: '',
    enabled: true,
    brand: 'auto',
    endpoint: 'auto',
    _testing: false,
    _testResult: null,
    ...overrides,
    thinking: newThinking(overrides.thinking),
    sampling: newSampling(overrides.sampling)
  }
}
function newProvider(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
  return { id: crypto.randomUUID(), name: '', baseURL: '', apiKey: '', models: [], ...overrides }
}

// ── 生命周期 ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const config = await ipcRenderer.invoke('boss-fetch-llm-config')
    providers.value = (config?.providers ?? []).map((p: ProviderEntry) => ({
      ...newProvider(),
      ...p,
      models: (p.models ?? []).map((m: ModelEntry) => newModel(m))
    }))
    const srcPurposes = config?.purposes ?? {}
    for (const purpose of PURPOSE_LIST) {
      const ids = srcPurposes[purpose.key]?.modelIds
      purposeChains[purpose.key].modelIds = Array.isArray(ids) ? [...ids] : []
    }
    if (config?.retry) Object.assign(retry, config.retry)
    for (const p of providers.value) {
      for (const m of p.models) detectBrand(p, m)
    }
  } catch (err) {
    console.error('[BossLlmConfig] 加载配置失败', err)
  } finally {
    isLoading.value = false
  }
})

// ── 品牌识别 ─────────────────────────────────────────────────────────────────
async function detectBrand(p: ProviderEntry, m: ModelEntry) {
  if (!m.model || !p.baseURL) return
  try {
    detected[m.id] = await ipcRenderer.invoke('boss-detect-brand', {
      baseURL: p.baseURL,
      model: m.model,
      endpoint: m.endpoint,
      brand: m.brand
    })
  } catch {
    // 识别失败忽略
  }
}
function detectProviderModels(p: ProviderEntry) {
  for (const m of p.models) detectBrand(p, m)
}

function isOpenAi(m: ModelEntry): boolean {
  return m.brand === 'openai' || (detected[m.id]?.dialectId ?? '').startsWith('openai')
}
// thinkingStyle 由后端 detect-brand 按「品牌锁定 + 模型名」综合给出（含 DeepSeek
// reasoner→model_name / V4→thinking_type 的区分），故直接采用 detected 结果。
function thinkingKind(m: ModelEntry): 'budget' | 'toggle' | 'effort' | 'model_name' | 'none' {
  const style = detected[m.id]?.thinkingStyle
  if (style === 'reasoning_effort') return 'effort'
  if (style === 'thinking_type') return 'toggle'
  if (style === 'model_name') return 'model_name'
  if (style === 'none') return 'none'
  return 'budget'
}
function effortValues(m: ModelEntry): string[] {
  return detected[m.id]?.effortValues ?? ['low', 'medium', 'high']
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
function addProvider() {
  providers.value.push(newProvider())
}
function removeProvider(pIdx: number) {
  providers.value.splice(pIdx, 1)
}
function addModel(pIdx: number) {
  providers.value[pIdx].models.push(newModel())
}
function removeModel(pIdx: number, mIdx: number) {
  providers.value[pIdx].models.splice(mIdx, 1)
}
function addPreset(preset: (typeof presets)[0]) {
  providers.value.push(
    newProvider({
      name: preset.name,
      baseURL: preset.baseURL,
      models: preset.models.map((m) => newModel(m as Partial<ModelEntry>))
    })
  )
}

// ── 测试连接 ─────────────────────────────────────────────────────────────────
async function handleTestEndpoint(p: ProviderEntry, m: ModelEntry) {
  m._testing = true
  m._testResult = null
  try {
    m._testResult = await ipcRenderer.invoke('boss-test-llm-endpoint', {
      baseURL: p.baseURL,
      apiKey: p.apiKey
    })
  } catch (err: unknown) {
    m._testResult = { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    m._testing = false
  }
}

// ── 保存 ─────────────────────────────────────────────────────────────────────
async function handleSave() {
  isSaving.value = true
  try {
    const config = {
      version: 2,
      providers: providers.value.map((p) => ({
        id: p.id,
        name: p.name,
        baseURL: p.baseURL,
        apiKey: p.apiKey,
        models: p.models.map((m) => ({
          id: m.id,
          name: m.name,
          model: m.model,
          enabled: m.enabled,
          brand: m.brand,
          endpoint: m.endpoint,
          thinking: { ...m.thinking },
          sampling: { ...m.sampling }
        }))
      })),
      purposes: JSON.parse(JSON.stringify(purposeChains)),
      retry: { ...retry }
    }
    await ipcRenderer.invoke('boss-save-llm-config', JSON.stringify(config))
    ElMessage({ type: 'success', message: '配置已保存' })
  } catch (err: unknown) {
    ElMessage({
      type: 'error',
      message: `保存失败：${err instanceof Error ? err.message : String(err)}`
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<style lang="scss" scoped>
.boss-llm-config__wrap {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;

  .page-header {
    .page-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .page-desc {
      font-size: 13px;
      color: #909399;
      line-height: 1.7;
    }
  }

  .provider-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .provider-card {
    .provider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;

      .provider-header-left {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        margin-right: 12px;
      }

      .provider-name-input {
        flex: 1;
        max-width: 280px;
      }
    }

    .provider-conn {
      margin-bottom: 12px;
    }

    .model-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .model-row {
      background: #f8fdfb;
      border: 1px solid #dce8e6;
      border-radius: 6px;
      padding: 12px 14px;

      .model-row-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;

        .model-name-input {
          flex: 1;
          min-width: 0;
        }
      }

      .model-id-item {
        margin-bottom: 10px;
      }

      .inline-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;

        .inline-label {
          font-size: 13px;
          color: #606266;
          width: 64px;
          flex-shrink: 0;
        }
      }

      .advanced {
        margin-top: 4px;
      }

      .sampling-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;

        .sampling-label {
          font-size: 12px;
          color: #909399;
          margin-bottom: 2px;
        }
      }
    }

    .add-model-bar {
      margin-top: 12px;
    }
  }

  .form-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
  }

  .section-desc {
    font-size: 13px;
    color: #909399;
    margin-bottom: 14px;
    line-height: 1.7;
  }

  .add-provider-bar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
  }

  .action-bar {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 0 8px;
    border-top: 1px solid #ebeef5;
    position: sticky;
    bottom: 0;
    background: #fff;
    z-index: 1;
  }
}
</style>
