<template>
  <div class="boss-llm-config__wrap">
    <div class="page-header">
      <div class="page-title">招聘端大语言模型配置</div>
      <div class="page-desc">
        配置用于简历筛选、评分标准生成等功能的 LLM。此配置独立于应聘端，保存到
        <code>boss-llm.json</code>（v2）。
      </div>
    </div>

    <el-tabs v-model="activeTab">
      <!-- ── Tab 1：模型 ───────────────────────────────────────────── -->
      <el-tab-pane label="模型" name="models">
        <el-empty v-if="!providers.length" description="暂无服务商，请添加" />

        <el-card
          v-for="(provider, pi) in providers"
          :key="provider.id"
          class="provider-card"
          shadow="never"
        >
          <div class="provider-head">
            <el-input
              v-model="provider.name"
              placeholder="服务商名称"
              size="small"
              style="width: 160px"
            />
            <el-input
              v-model="provider.baseURL"
              placeholder="https://api.siliconflow.cn/v1"
              size="small"
              style="width: 260px"
            />
            <el-input
              v-model="provider.apiKey"
              type="password"
              show-password
              placeholder="sk-xxx"
              size="small"
              style="width: 200px"
            />
            <el-button size="small" :loading="provider._testing" @click="testProvider(provider)"
              >测试连接</el-button
            >
            <el-button size="small" @click="addModel(provider)">+ 模型</el-button>
            <el-button size="small" type="danger" text @click="removeProvider(pi)"
              >删除服务商</el-button
            >
          </div>

          <el-alert
            v-if="provider._testResult"
            :type="provider._testResult.ok ? 'success' : 'error'"
            :title="
              provider._testResult.ok ? '连接成功' : `连接失败：${provider._testResult.error}`
            "
            show-icon
            :closable="false"
            style="margin: 6px 0"
          />

          <div v-for="(model, mi) in provider.models" :key="model.id" class="model-card">
            <div class="model-head">
              <el-switch v-model="model.enabled" />
              <el-input
                v-model="model.name"
                placeholder="模型别名"
                size="small"
                style="width: 220px"
              />
              <el-button size="small" type="danger" text @click="removeModel(provider, mi)"
                >删除</el-button
              >
            </div>

            <el-form label-position="top" class="model-form">
              <el-form-item label="Model ID">
                <el-input
                  v-model="model.model"
                  placeholder="Pro/deepseek-ai/DeepSeek-R1"
                  @blur="detectBrand(provider, model)"
                />
              </el-form-item>

              <div class="brand-row">
                <span class="brand-label">品牌：</span>
                <el-tag
                  v-if="model.brand === 'auto' && detected[model.id]"
                  size="small"
                  type="info"
                >
                  自动识别 → {{ detected[model.id].label }}
                </el-tag>
                <el-select
                  v-model="model.brand"
                  size="small"
                  style="width: 160px"
                  @change="detectBrand(provider, model)"
                >
                  <el-option
                    v-for="b in BRAND_OPTIONS"
                    :key="b.value"
                    :label="b.label"
                    :value="b.value"
                  />
                </el-select>
              </div>

              <div v-if="isOpenAi(model)" class="endpoint-row">
                <span class="brand-label">Endpoint：</span>
                <el-select
                  v-model="model.endpoint"
                  size="small"
                  style="width: 160px"
                  @change="detectBrand(provider, model)"
                >
                  <el-option label="自动" value="auto" />
                  <el-option label="Chat" value="chat" />
                  <el-option label="Responses" value="responses" />
                </el-select>
              </div>

              <el-form-item label="Thinking / 推理">
                <div class="thinking-row">
                  <template v-if="thinkingKind(model) === 'budget'">
                    <el-checkbox v-model="model.thinking.enabled">启用 Thinking</el-checkbox>
                    <el-input-number
                      v-if="model.thinking.enabled"
                      v-model="model.thinking.budget"
                      :min="128"
                      :max="32768"
                      :step="512"
                      controls-position="right"
                      style="width: 150px; margin-left: 12px"
                    />
                    <span v-if="model.thinking.enabled" class="form-tip">Token 预算</span>
                  </template>
                  <template v-else-if="thinkingKind(model) === 'toggle'">
                    <el-checkbox v-model="model.thinking.enabled">启用 Thinking</el-checkbox>
                  </template>
                  <template v-else-if="thinkingKind(model) === 'effort'">
                    <el-checkbox v-model="model.thinking.enabled">启用</el-checkbox>
                    <el-radio-group
                      v-if="model.thinking.enabled"
                      v-model="model.thinking.effort"
                      size="small"
                      style="margin-left: 12px"
                    >
                      <el-radio-button v-for="ev in effortValues(model)" :key="ev" :value="ev">{{
                        ev
                      }}</el-radio-button>
                    </el-radio-group>
                  </template>
                  <template v-else>
                    <span class="form-tip">该模型由模型名决定是否推理（如 deepseek-reasoner）</span>
                  </template>
                </div>
              </el-form-item>

              <el-collapse>
                <el-collapse-item title="高级参数（留空 = 自动 / 品牌默认）">
                  <div class="sampling-grid">
                    <div>
                      <div class="sampling-label">temperature</div>
                      <el-input-number
                        v-model="model.sampling.temperature"
                        :precision="2"
                        :step="0.1"
                        controls-position="right"
                        style="width: 100%"
                      />
                    </div>
                    <div>
                      <div class="sampling-label">max_tokens</div>
                      <el-input-number
                        v-model="model.sampling.max_tokens"
                        :min="1"
                        controls-position="right"
                        style="width: 100%"
                      />
                    </div>
                    <div>
                      <div class="sampling-label">top_p</div>
                      <el-input-number
                        v-model="model.sampling.top_p"
                        :precision="2"
                        :step="0.1"
                        controls-position="right"
                        style="width: 100%"
                      />
                    </div>
                    <div>
                      <div class="sampling-label">frequency_penalty</div>
                      <el-input-number
                        v-model="model.sampling.frequency_penalty"
                        :precision="2"
                        :step="0.1"
                        controls-position="right"
                        style="width: 100%"
                      />
                    </div>
                    <div>
                      <div class="sampling-label">presence_penalty</div>
                      <el-input-number
                        v-model="model.sampling.presence_penalty"
                        :precision="2"
                        :step="0.1"
                        controls-position="right"
                        style="width: 100%"
                      />
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>
            </el-form>
          </div>
        </el-card>

        <div class="add-bar">
          <el-button type="primary" plain @click="addProvider">+ 添加服务商</el-button>
          <el-dropdown @command="addPreset">
            <el-button plain
              >从预设添加 <el-icon class="el-icon--right"><ArrowDown /></el-icon
            ></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="p in presets" :key="p.name" :command="p">{{
                  p.name
                }}</el-dropdown-item>
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
        <el-form label-position="top">
          <el-form-item v-for="p in PURPOSE_LIST" :key="p.key" :label="p.label">
            <el-select
              v-model="purposes[p.key].modelIds"
              multiple
              filterable
              placeholder="（留空 = 回落默认 / 全局启用顺序）"
              style="width: 100%"
            >
              <el-option v-for="m in allEnabledModels" :key="m.id" :label="m.label" :value="m.id" />
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
      <el-button @click="handleClose">关闭</el-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'

const { ipcRenderer } = electron

// ── 类型 ───────────────────────────────────────────────────────────────────
interface Thinking {
  enabled: boolean
  budget: number
  effort: string
}
interface Sampling {
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
  thinking: Thinking
  sampling: Sampling
}
interface Provider {
  id: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelEntry[]
  _testing?: boolean
  _testResult?: { ok: boolean; error?: string } | null
}
interface DetectResult {
  dialectId: string
  label: string
  isReasoningModel: boolean
  effortValues: string[] | null
  thinkingStyle: string
}

// ── 常量 ───────────────────────────────────────────────────────────────────
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
const presets = [
  {
    name: 'SiliconFlow - DeepSeek-R1',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Pro/deepseek-ai/DeepSeek-R1',
    thinking: true
  },
  {
    name: 'SiliconFlow - DeepSeek-V3',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Pro/deepseek-ai/DeepSeek-V3',
    thinking: false
  },
  {
    name: 'DeepSeek 官方 - Reasoner',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-reasoner',
    thinking: false
  },
  {
    name: '阿里云百炼 - Qwen-Plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    thinking: false
  }
]

// ── 状态 ───────────────────────────────────────────────────────────────────
const activeTab = ref('models')
const providers = ref<Provider[]>([])
const purposes = reactive<Record<string, { modelIds: string[] }>>({})
const retry = reactive({
  maxAttemptsPerModel: 2,
  backoffMs: 500,
  maxBackoffMs: 20000,
  totalDeadlineMs: 120000
})
const detected = reactive<Record<string, DetectResult>>({})
const isSaving = ref(false)

const allEnabledModels = computed(() =>
  providers.value.flatMap((p) =>
    p.models
      .filter((m) => m.enabled)
      .map((m) => ({ id: m.id, label: m.name || m.model || '(未命名)' }))
  )
)

// ── 工厂 ───────────────────────────────────────────────────────────────────
function newModel(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: crypto.randomUUID(),
    name: '',
    model: '',
    enabled: true,
    brand: 'auto',
    endpoint: 'auto',
    thinking: { enabled: false, budget: 2048, effort: 'medium' },
    sampling: {
      temperature: null,
      max_tokens: null,
      top_p: null,
      frequency_penalty: null,
      presence_penalty: null
    },
    ...overrides
  }
}
function newProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: crypto.randomUUID(),
    name: '新服务商',
    baseURL: '',
    apiKey: '',
    models: [],
    _testing: false,
    _testResult: null,
    ...overrides
  }
}

// ── 加载 ───────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const config = await ipcRenderer.invoke('boss-fetch-llm-config')
    providers.value = (config?.providers ?? []).map((p: Provider) => ({
      ...newProvider(),
      ...p,
      models: (p.models ?? []).map((m: ModelEntry) => ({
        ...newModel(),
        ...m,
        thinking: { ...newModel().thinking, ...(m.thinking ?? {}) },
        sampling: { ...newModel().sampling, ...(m.sampling ?? {}) }
      }))
    }))
    const srcPurposes = config?.purposes ?? {}
    for (const p of PURPOSE_LIST) {
      const ids = srcPurposes[p.key]?.modelIds
      purposes[p.key] = { modelIds: Array.isArray(ids) ? ids : [] }
    }
    Object.assign(retry, config?.retry ?? {})
    // 初次识别已有模型品牌
    for (const provider of providers.value) {
      for (const model of provider.models) detectBrand(provider, model)
    }
  } catch (err) {
    console.error('[BossLlmConfig] 加载配置失败', err)
  }
})

// ── 品牌识别 ─────────────────────────────────────────────────────────────────
async function detectBrand(provider: Provider, model: ModelEntry) {
  if (!model.model || !provider.baseURL) return
  try {
    const res = await ipcRenderer.invoke('boss-detect-brand', {
      baseURL: provider.baseURL,
      model: model.model,
      endpoint: model.endpoint
    })
    detected[model.id] = res
  } catch {
    // 忽略识别失败
  }
}

function isOpenAi(model: ModelEntry): boolean {
  return model.brand === 'openai' || (detected[model.id]?.dialectId ?? '').startsWith('openai')
}

function brandToStyle(brand: string): string {
  const map: Record<string, string> = {
    qwen: 'qwen_enable',
    deepseek: 'model_name',
    glm: 'thinking_type',
    openai: 'reasoning_effort',
    generic: 'top_level_enable'
  }
  return map[brand] || 'top_level_enable'
}
function thinkingKind(model: ModelEntry): 'budget' | 'toggle' | 'effort' | 'model_name' {
  const style =
    model.brand === 'auto' ? detected[model.id]?.thinkingStyle : brandToStyle(model.brand)
  if (style === 'reasoning_effort') return 'effort'
  if (style === 'thinking_type') return 'toggle'
  if (style === 'model_name') return 'model_name'
  return 'budget'
}
function effortValues(model: ModelEntry): string[] {
  return detected[model.id]?.effortValues ?? ['low', 'medium', 'high']
}

// ── CRUD ────────────────────────────────────────────────────────────────────
function addProvider() {
  providers.value.push(newProvider())
}
function removeProvider(idx: number) {
  providers.value.splice(idx, 1)
}
function addModel(provider: Provider) {
  provider.models.push(newModel())
}
function removeModel(provider: Provider, idx: number) {
  provider.models.splice(idx, 1)
}
function addPreset(preset: (typeof presets)[0]) {
  providers.value.push(
    newProvider({
      name: preset.name,
      baseURL: preset.baseURL,
      models: [
        newModel({
          name: preset.name,
          model: preset.model,
          thinking: { enabled: preset.thinking, budget: 2048, effort: 'medium' }
        })
      ]
    })
  )
}

// ── 测试连接 ─────────────────────────────────────────────────────────────────
async function testProvider(provider: Provider) {
  provider._testing = true
  provider._testResult = null
  try {
    provider._testResult = await ipcRenderer.invoke('boss-test-llm-endpoint', {
      baseURL: provider.baseURL,
      apiKey: provider.apiKey
    })
  } catch (err: unknown) {
    provider._testResult = { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    provider._testing = false
  }
}

// ── 保存 ───────────────────────────────────────────────────────────────────
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
        models: p.models
      })),
      purposes: JSON.parse(JSON.stringify(purposes)),
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

function handleClose() {
  ipcRenderer.send('close-boss-llm-config')
}
</script>

<style lang="scss" scoped>
.boss-llm-config__wrap {
  padding: 24px;
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100vh;
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

  .provider-card {
    margin-bottom: 14px;
    border: 1px solid #ebeef5;

    .provider-head {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
  }

  .model-card {
    border: 1px dashed #dcdfe6;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 10px 0;

    .model-head {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }

    .brand-row,
    .endpoint-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;

      .brand-label {
        font-size: 13px;
        color: #606266;
      }
    }

    .thinking-row {
      display: flex;
      align-items: center;
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

    .form-tip {
      font-size: 12px;
      color: #909399;
      margin-left: 8px;
    }
  }

  .add-bar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
  }

  .section-desc {
    font-size: 13px;
    color: #909399;
    margin-bottom: 14px;
    line-height: 1.7;
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
