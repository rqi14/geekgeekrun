<template>
  <el-form label-position="top">
    <el-alert
      class="mb16"
      type="warning"
      :closable="false"
      title="此前激进滚动导致账号被封；以下上限是自我约束，调小更安全。"
    />

    <el-card class="config-section">
      <div class="section-title">每轮上限</div>
      <el-form-item label="每轮最多打招呼人数">
        <el-input-number v-model="model.maxGreetPerRun" :min="0" controls-position="right" />
      </el-form-item>
      <el-form-item label="每轮最多 X（不感兴趣）人数">
        <el-input-number v-model="model.maxXPerRun" :min="0" controls-position="right" />
      </el-form-item>
      <el-form-item label="每轮最多滚动步数（唯一滚动点）">
        <el-input-number v-model="model.maxScrollSteps" :min="0" controls-position="right" />
        <div class="form-tip">滚动越少越安全。</div>
      </el-form-item>
      <el-form-item label="最多连续空波次数">
        <el-input-number v-model="model.maxStaleWaves" :min="0" controls-position="right" />
      </el-form-item>
      <el-form-item label="每波处理候选人数（waveSize）">
        <el-input-number v-model="model.waveSize" :min="1" controls-position="right" />
      </el-form-item>
    </el-card>

    <el-card class="config-section">
      <div class="section-title">节奏（反检测）</div>
      <el-form-item label="滚动间隔（毫秒，随机 [min,max]）">
        <div class="range-input-wrap">
          <el-input-number
            v-model="model.scrollDelayMsRange[0]"
            :min="0"
            controls-position="right"
            placeholder="最小"
          />
          <span class="range-sep">~</span>
          <el-input-number
            v-model="model.scrollDelayMsRange[1]"
            :min="0"
            controls-position="right"
            placeholder="最大"
          />
        </div>
      </el-form-item>
      <el-form-item label="动作间隔（毫秒，随机 [min,max]）">
        <div class="range-input-wrap">
          <el-input-number
            v-model="model.delayBetweenActionsMs[0]"
            :min="0"
            controls-position="right"
            placeholder="最小"
          />
          <span class="range-sep">~</span>
          <el-input-number
            v-model="model.delayBetweenActionsMs[1]"
            :min="0"
            controls-position="right"
            placeholder="最大"
          />
        </div>
      </el-form-item>
    </el-card>

    <el-card class="config-section">
      <div class="section-title">招呼语</div>
      <el-form-item label="招呼语">
        <el-input
          v-model="model.greetingMessage"
          type="textarea"
          :autosize="{ minRows: 2 }"
          placeholder="向候选人发送的第一条消息"
        />
      </el-form-item>
      <el-form-item label="每轮最多开聊人数">
        <el-input-number v-model="model.maxChatPerRun" :min="0" controls-position="right" />
      </el-form-item>
    </el-card>
  </el-form>
</template>

<script lang="ts" setup>
import type { BudgetState } from './mapping'

const model = defineModel<BudgetState>({ required: true })
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
}

.mb16 {
  margin-bottom: 16px;
}

.range-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;

  .range-sep {
    color: #999;
  }
}
</style>
