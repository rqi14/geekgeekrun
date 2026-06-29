<template>
  <div class="recommend-automation__wrap">
    <div class="main__wrap">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="筛选与评分已集中到「职位配置」(按职位设置)"
        style="margin-bottom: 16px"
      >
        此页只配置运行预算/节奏与执行。按职位运行时使用对应职位的配置。
      </el-alert>
      <el-tabs v-if="loaded" v-model="activeTab" type="border-card">
        <el-tab-pane label="预算&节奏" name="budget">
          <BudgetTab v-model="state.budget" />
        </el-tab-pane>
        <el-tab-pane label="执行" name="run">
          <RunTab v-model="state.run" :sequence-jobs-enabled="sequenceJobsEnabled" />
        </el-tab-pane>
      </el-tabs>
      <div v-else class="loading-placeholder">配置加载中…</div>

      <div v-if="regexError" class="regex-warn">
        筛选条件中存在无效正则（学历或屏蔽姓名），请修正后再保存：{{ regexError }}
      </div>

      <div class="flow-hint">流程：卡片初筛(省点击) → 开简历LLM精排 → 按分打招呼。</div>

      <div class="action-bar">
        <el-select
          v-model="selectedJobId"
          clearable
          filterable
          placeholder="运行职位（默认=BOSS 当前选中）"
          style="width: 240px"
        >
          <el-option v-for="j in jobs" :key="j.jobId" :label="j.jobName" :value="j.jobId" />
        </el-select>
        <el-button :loading="isSaving" :disabled="!!regexError" @click="handleSave"
          >仅保存</el-button
        >
        <el-button
          type="primary"
          :loading="isSaving"
          :disabled="!!regexError"
          @click="handleSaveAndRun"
        >
          保存并运行
        </el-button>
      </div>
    </div>

    <div class="running-overlay__wrap" :style="{ pointerEvents: 'none' }">
      <RunningOverlay
        ref="runningOverlayRef"
        worker-id="bossRecommendMain"
        :run-record-id="runRecordId"
        :get-steps="getBossAutoBrowseSteps"
      >
        <template #op-buttons="{ currentRunningStatus }">
          <div>
            <template v-if="currentRunningStatus === RUNNING_STATUS_ENUM.RUNNING">
              <el-button
                type="danger"
                plain
                :loading="isStopButtonLoading"
                @click="handleStopButtonClick"
                >结束任务</el-button
              >
            </template>
            <template v-else>
              <el-button
                type="primary"
                @click="
                  () => {
                    runningOverlayRef?.hide?.()
                  }
                "
                >关闭</el-button
              >
            </template>
          </div>
        </template>
      </RunningOverlay>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../../common/enums/auto-start-chat'
import { getBossAutoBrowseSteps } from '../../../../../common/prerequisite-step-by-step-check'
import { normalizeRecommendConfig } from './mapping'
import type { RecommendConfigState } from './mapping'
import { loadRecommendConfig, saveRecommendConfig, fetchEnabledModels } from './useRecommendConfig'
import BudgetTab from './BudgetTab.vue'
import RunTab from './RunTab.vue'

const { ipcRenderer } = electron

const activeTab = ref('budget')
const loaded = ref(false)
const isSaving = ref(false)

const checkRegex = (v: string): string => {
  if (!v) return ''
  try {
    // eslint-disable-next-line no-new
    new RegExp(v)
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const regexError = computed(
  () =>
    checkRegex(state.filter.expectEducationRegExpStr) ||
    checkRegex(state.filter.blockCandidateNameRegExpStr)
)
const runRecordId = ref<number | undefined>(undefined)
const runningOverlayRef = ref<InstanceType<typeof RunningOverlay> | null>(null)
const isStopButtonLoading = ref(false)
const sequenceJobsEnabled = ref(false)
const models = ref<Array<{ id: string; label: string }>>([])
const jobs = ref<Array<{ jobId: string; jobName: string }>>([])
const selectedJobId = ref<string>('') // 空 = 用 BOSS 页当前选中的职位,不切换

const state = reactive(normalizeRecommendConfig({})) as RecommendConfigState

const applyState = (next: RecommendConfigState) => {
  Object.assign(state.scoring, next.scoring)
  Object.assign(state.filter, next.filter)
  Object.assign(state.budget, next.budget)
  Object.assign(state.run, next.run)
}

// 仅刷新职位下拉（参考数据），不动用户正在编辑的表单 state；mount + 每次切回页面都拉一次
const loadJobs = async () => {
  try {
    const jobsConfig = await ipcRenderer.invoke('fetch-boss-jobs-config')
    const list = jobsConfig?.jobs ?? []
    jobs.value = list.map((j: { jobId?: string; id?: string; jobName?: string; name?: string }) => ({
      jobId: j.jobId ?? j.id ?? '',
      jobName: j.jobName ?? j.name ?? j.jobId ?? j.id ?? ''
    }))
    sequenceJobsEnabled.value = Array.isArray(list)
      ? list.some((j: { sequence?: { enabled?: boolean } }) => j?.sequence?.enabled === true)
      : false
  } catch (err) {
    console.error('[RecommendAutomation] 拉取职位列表失败', err)
  }
}

onActivated(() => {
  loadJobs()
})

onMounted(async () => {
  try {
    const { state: loadedState, sequenceJobsEnabled: seq } = await loadRecommendConfig()
    applyState(loadedState)
    sequenceJobsEnabled.value = seq
  } catch (err) {
    console.error(err)
    ElMessage({ type: 'error', message: '加载配置失败，已使用默认值' })
    applyState(normalizeRecommendConfig({}))
  } finally {
    loaded.value = true
  }
  try {
    models.value = await fetchEnabledModels()
  } catch (err) {
    console.error('[RecommendAutomation] 拉取模型失败', err)
  }
  await loadJobs()
})

const doSave = async () => {
  await saveRecommendConfig(state)
}

const handleSave = async () => {
  isSaving.value = true
  try {
    await doSave()
    ElMessage({ type: 'success', message: '配置已保存' })
  } catch (err) {
    ElMessage({ type: 'error', message: '保存失败' })
    console.error(err)
  } finally {
    isSaving.value = false
  }
}

const handleSaveAndRun = async () => {
  if (state.scoring.enabled && !state.scoring.jd) {
    try {
      await ElMessageBox.confirm(
        '已开启 LLM 精排，但未填写 JD（也无 rubric），评分将回退为「仅规则初筛」。是否继续？',
        '评分将回退规则-only',
        {
          confirmButtonText: '继续',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )
    } catch {
      return
    }
  }
  isSaving.value = true
  try {
    await doSave()
    runningOverlayRef.value?.show()
    const { runRecordId: rrId } = await ipcRenderer.invoke('run-boss-recommend', {
      jobId: selectedJobId.value || null
    })
    runRecordId.value = rrId
  } catch (err) {
    console.error(err)
  } finally {
    isSaving.value = false
  }
}

const handleStopButtonClick = async () => {
  isStopButtonLoading.value = true
  try {
    await ipcRenderer.invoke('stop-boss-recommend')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.recommend-automation__wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;

  .main__wrap {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
  }

  .flow-hint {
    font-size: 13px;
    color: #606266;
    margin: 16px 0 8px;
  }

  .loading-placeholder {
    padding: 48px 0;
    text-align: center;
    color: #909399;
  }

  .regex-warn {
    margin-top: 12px;
    padding: 8px 12px;
    font-size: 13px;
    color: #f56c6c;
    background: #fef0f0;
    border-radius: 4px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 500;
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
    line-height: 1.4;
  }

  .range-input-wrap {
    display: flex;
    align-items: center;
    gap: 8px;

    .range-sep {
      color: #999;
    }
  }

  .action-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 0;
  }
}

.running-overlay__wrap {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>
