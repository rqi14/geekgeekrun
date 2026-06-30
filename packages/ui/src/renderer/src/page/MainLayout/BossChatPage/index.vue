<template>
  <div class="boss-chat-page__wrap">
    <div class="main__wrap">
      <el-form :model="formContent" label-position="top">
        <el-card class="config-section">
          <el-form-item mb0>
            <div class="section-title">沟通页运行策略</div>
          </el-form-item>
          <el-form-item label="每次最多处理未读会话数">
            <el-input-number
              v-model="formContent.chatPage.maxProcessPerRun"
              :min="1"
              :max="100"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="formContent.chatPage.runOnceAfterComplete">
              单轮运行完成后停止（不再自动重启）
            </el-checkbox>
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="formContent.chatPage.keepBrowserOpenAfterRun">
              单轮结束后保持浏览器打开（需同时勾选「单轮运行完成后停止」；关闭浏览器后自动退出）
            </el-checkbox>
          </el-form-item>
          <el-form-item label="两轮之间的等待间隔（毫秒）">
            <el-input-number
              v-model="formContent.chatPage.rerunIntervalMs"
              :min="1000"
              controls-position="right"
              placeholder="默认 3000"
            />
          </el-form-item>
          <el-form-item>
            <el-checkbox v-model="formContent.chatPage.attachmentResume.skipDownload">
              不打开/下载对方发来的附件简历 PDF
            </el-checkbox>
            <div class="form-tip">
              开启后仍会同意对方发送附件简历，也会发送索取附件简历请求，但检测到附件简历消息时不再点开预览和下载 PDF。
            </div>
          </el-form-item>
        </el-card>

        <el-alert
          title="候选人筛选条件及简历筛选规则请在「职位配置」页面按职位配置"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 16px"
        >
          职位执行队列请在「职位执行队列」页面配置。
        </el-alert>

        <div class="action-bar">
          <el-button :loading="isSaving" @click="handleSave">仅保存配置</el-button>
          <el-button type="primary" :loading="isSaving" @click="handleSubmit">
            保存配置，并开始处理沟通页！
          </el-button>
        </div>
      </el-form>
    </div>

    <div
      class="running-overlay__wrap"
      :style="{
        pointerEvents: 'none'
      }"
    >
      <RunningOverlay
        ref="runningOverlayRef"
        worker-id="bossChatPageMain"
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
import { ref, reactive, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'
import RunningOverlay from '@renderer/features/RunningOverlay/index.vue'
import { RUNNING_STATUS_ENUM } from '../../../../../common/enums/auto-start-chat'
import { getBossAutoBrowseSteps } from '../../../../../common/prerequisite-step-by-step-check'
import {
  normalizeBossChatPageConfig,
  toSavePayload,
  type BossChatPageState
} from './mapping'

const { ipcRenderer } = electron

const isSaving = ref(false)
const runRecordId = ref<number | undefined>(undefined)
const runningOverlayRef = ref<InstanceType<typeof RunningOverlay> | null>(null)
const isStopButtonLoading = ref(false)

const formContent = reactive<BossChatPageState>(
  normalizeBossChatPageConfig({ 'boss-recruiter.json': {} })
)

const loadData = async () => {
  try {
    const recruiterResult = await ipcRenderer.invoke('fetch-boss-recruiter-config-file-content')
    const state = normalizeBossChatPageConfig(recruiterResult?.config ?? {})
    Object.assign(formContent.chatPage, state.chatPage)
  } catch (err) {
    console.error(err)
  }
}

onMounted(loadData)
onActivated(loadData)

const doSave = async () => {
  const payload = toSavePayload(formContent)
  await ipcRenderer.invoke('save-boss-recruiter-config', JSON.stringify(payload))
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

const handleSubmit = async () => {
  isSaving.value = true
  try {
    await doSave()
    runningOverlayRef.value?.show()
    const { runRecordId: rrId } = await ipcRenderer.invoke('run-boss-chat-page')
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
    await ipcRenderer.invoke('stop-boss-chat-page')
    runningOverlayRef.value?.hide()
  } finally {
    isStopButtonLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.boss-chat-page__wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;

  .main__wrap {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
  }

  .config-section {
    margin-bottom: 16px;

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
