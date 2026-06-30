<template>
  <el-form label-position="top">
    <el-alert
      v-if="sequenceJobsEnabled"
      class="mb16"
      type="info"
      :closable="false"
      title="检测到已启用的顺序执行职位；本页（全局）筛选仅对「推荐牛人单跑」生效，顺序执行模式由各职位配置（职位配置页）决定。"
    />

    <el-card class="config-section">
      <div class="section-title">初筛拒绝处理</div>
      <el-form-item>
        <el-checkbox v-model="model.clickNotInterestedForFiltered">
          对未通过初筛的候选人点「不感兴趣」(X)；关 = 只跳过不点
        </el-checkbox>
      </el-form-item>
    </el-card>

    <el-card class="config-section">
      <div class="section-title">仅「推荐牛人」单跑生效</div>
      <div class="form-tip mb12">以下选项仅在「推荐牛人单跑」模式生效；顺序执行模式不读取。</div>
      <el-form-item>
        <el-checkbox v-model="model.runOnceAfterComplete">
          单轮运行完成后停止（不再自动重启）
        </el-checkbox>
      </el-form-item>
      <el-form-item label="两轮之间的等待间隔（毫秒）">
        <el-input-number
          v-model="model.rerunIntervalMs"
          :min="0"
          :value-on-clear="0"
          :disabled="model.runOnceAfterComplete"
          controls-position="right"
        />
        <div class="form-tip">仅在「不勾选单轮停止」时生效。</div>
      </el-form-item>
      <el-form-item>
        <el-checkbox
          v-model="model.keepBrowserOpenAfterRun"
          :disabled="!model.runOnceAfterComplete"
        >
          单轮结束后保持浏览器打开（需同时勾选「单轮运行完成后停止」）
        </el-checkbox>
      </el-form-item>
    </el-card>
  </el-form>
</template>

<script lang="ts" setup>
import type { RunState } from './mapping'

defineProps<{
  sequenceJobsEnabled: boolean
}>()

const model = defineModel<RunState>({ required: true })
</script>

<style lang="scss" scoped>
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

  .mb12 {
    margin-bottom: 12px;
  }
}

.mb16 {
  margin-bottom: 16px;
}
</style>
