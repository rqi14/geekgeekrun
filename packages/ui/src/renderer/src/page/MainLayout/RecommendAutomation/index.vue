<template>
  <div class="recommend-automation__wrap">
    <div class="main__wrap">
      <el-tabs v-model="activeTab" type="border-card">
        <el-tab-pane label="职位&评分" name="scoring">
          <ScoringTab v-model="state.scoring" :models="models" />
        </el-tab-pane>
        <el-tab-pane label="卡片初筛" name="filter">
          <CardFilterTab v-model="state.filter" />
        </el-tab-pane>
        <el-tab-pane label="预算&节奏" name="budget">
          <BudgetTab v-model="state.budget" />
        </el-tab-pane>
        <el-tab-pane label="执行" name="run">
          <RunTab v-model="state.run" :sequence-jobs-enabled="sequenceJobsEnabled" />
        </el-tab-pane>
      </el-tabs>

      <div class="flow-hint">流程：卡片初筛(省点击) → 开简历LLM精排 → 按分打招呼。</div>

      <div class="action-bar">
        <el-button :loading="isSaving" @click="handleSave">仅保存</el-button>
        <el-button type="primary" :loading="isSaving" @click="handleSaveAndRun">
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../../common/enums/auto-start-chat'
import { getBossAutoBrowseSteps } from '../../../../../common/prerequisite-step-by-step-check'
import { normalizeRecommendConfig } from './mapping'
import type { RecommendConfigState } from './mapping'
import { loadRecommendConfig, saveRecommendConfig, fetchEnabledModels } from './useRecommendConfig'
import ScoringTab from './ScoringTab.vue'
import CardFilterTab from './CardFilterTab.vue'
import BudgetTab from './BudgetTab.vue'
import RunTab from './RunTab.vue'

const { ipcRenderer } = electron

const activeTab = ref('scoring')
const isSaving = ref(false)
const runRecordId = ref<number | undefined>(undefined)
const runningOverlayRef = ref<InstanceType<typeof RunningOverlay> | null>(null)
const isStopButtonLoading = ref(false)
const sequenceJobsEnabled = ref(false)
const models = ref<Array<{ id: string; label: string }>>([])

const state = reactive(normalizeRecommendConfig({})) as RecommendConfigState

const applyState = (next: RecommendConfigState) => {
  Object.assign(state.scoring, next.scoring)
  Object.assign(state.filter, next.filter)
  Object.assign(state.budget, next.budget)
  Object.assign(state.run, next.run)
}

onMounted(async () => {
  try {
    const { state: loaded, sequenceJobsEnabled: seq } = await loadRecommendConfig()
    applyState(loaded)
    sequenceJobsEnabled.value = seq
  } catch (err) {
    console.error(err)
    ElMessage({ type: 'error', message: '加载配置失败，已使用默认值' })
    applyState(normalizeRecommendConfig({}))
  }
  try {
    models.value = await fetchEnabledModels()
  } catch (err) {
    console.error('[RecommendAutomation] 拉取模型失败', err)
  }
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
    const { runRecordId: rrId } = await ipcRenderer.invoke('run-boss-recommend')
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
