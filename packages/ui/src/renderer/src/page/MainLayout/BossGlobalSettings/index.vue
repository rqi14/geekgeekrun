<template>
  <div class="boss-global-settings__wrap">
    <div class="main__wrap">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="全局运行设置"
        style="margin-bottom: 16px"
      >
        这里的设置对所有运行方式（推荐牛人、沟通、自动顺序执行）统一生效。
      </el-alert>

      <el-form label-position="top">
        <el-card class="config-section">
          <div class="section-title">高级反检测（实验性）</div>
          <el-form-item>
            <el-checkbox v-model="persistProfile">
              持久化浏览器 profile（更难被识别为新设备）
            </el-checkbox>
            <div class="form-tip">
              启用后 BOSS 看到的是「老设备」而非「每次都是新设备」，能显著降低人工验证触发率。<br />
              副作用：bot 运行期间不能在系统 Chrome 同时登录 BOSS（会被挤掉）；profile 文件夹长期会占用
              1-2GB 磁盘空间。<br />
              路径：<code>~/.geekgeekrun/storage/boss-chrome-profile/</code>
            </div>
          </el-form-item>
        </el-card>

        <div class="action-bar">
          <el-button type="primary" :loading="isSaving" @click="handleSave">保存设置</el-button>
        </div>
      </el-form>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onActivated } from 'vue'
import { ElMessage } from 'element-plus'

const { ipcRenderer } = electron

const persistProfile = ref(false)
const isSaving = ref(false)

const loadData = async () => {
  try {
    const result = await ipcRenderer.invoke('fetch-boss-recruiter-config-file-content')
    const recruiterConfig = result?.config?.['boss-recruiter.json'] || {}
    persistProfile.value = recruiterConfig.advanced?.persistProfile === true
  } catch (err) {
    console.error('[BossGlobalSettings] 读取配置失败', err)
  }
}

onMounted(loadData)
onActivated(loadData)

const handleSave = async () => {
  isSaving.value = true
  try {
    await ipcRenderer.invoke(
      'save-boss-recruiter-config',
      JSON.stringify({ advanced: { persistProfile: persistProfile.value } })
    )
    ElMessage({ type: 'success', message: '设置已保存' })
  } catch (err) {
    ElMessage({ type: 'error', message: '保存失败' })
    console.error(err)
  } finally {
    isSaving.value = false
  }
}
</script>

<style lang="scss" scoped>
.boss-global-settings__wrap {
  width: 100%;
  height: 100%;
  overflow: auto;

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
      margin-bottom: 8px;
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
</style>
