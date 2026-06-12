<template>
  <el-form label-position="top">
    <el-card class="config-section">
      <div class="section-title">职位描述 (JD)</div>
      <div class="form-tip mb12">
        填写 JD 用于驱动评分 rubric 自动生成。开启「LLM 精排」时，会在开简历后据此打分。
      </div>
      <el-form-item label="JD 文本">
        <el-input
          v-model="model.jd"
          type="textarea"
          :autosize="{ minRows: 4 }"
          placeholder="粘贴目标职位的职位描述，越具体评分越准"
        />
      </el-form-item>
    </el-card>

    <el-card class="config-section">
      <div class="section-title">LLM 精排</div>
      <el-form-item label="评分模式">
        <el-switch
          v-model="model.enabled"
          active-text="开：开简历后 LLM 精排"
          inactive-text="关：仅规则初筛"
        />
        <div class="form-tip">
          关 = 过卡片初筛即按规则打招呼；开 = 开简历后由 LLM 评分，达标才打招呼（更准但更慢、更消耗
          token）。
        </div>
      </el-form-item>
      <el-form-item label="达标分阈值（0–100）">
        <el-slider v-model="model.minScoreToChat" :min="0" :max="100" show-input />
        <div class="form-tip">分数达到此阈值才会打招呼。</div>
      </el-form-item>
      <el-form-item label="评分失败时">
        <el-radio-group v-model="model.onScoreError">
          <el-radio value="skip">遇评分失败跳过</el-radio>
          <el-radio value="greetIfRulePass">规则通过即打招呼</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="评分模型">
        <el-select v-model="model.modelId" clearable placeholder="用默认（按用途）">
          <el-option label="用默认（按用途）" :value="null" />
          <el-option v-for="m in models" :key="m.id" :label="m.label" :value="m.id" />
        </el-select>
        <div class="form-tip">
          供应商与模型在「配置大语言模型」(BossLlmConfig) 维护；完整可视化 rubric
          编辑仍在「职位配置」(BossJobConfig)。
        </div>
      </el-form-item>
    </el-card>
  </el-form>
</template>

<script lang="ts" setup>
import type { ScoringState } from './mapping'

defineProps<{
  models: Array<{ id: string; label: string }>
}>()

const model = defineModel<ScoringState>({ required: true })
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
</style>
