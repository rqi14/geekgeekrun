<template>
  <div class="filter-rule-row">
    <div class="filter-rule-row__head">
      <el-checkbox v-model="enabled">{{ label }}</el-checkbox>
    </div>
    <div
      class="filter-rule-row__slot"
      :style="enabled ? {} : { opacity: 0.5, pointerEvents: 'none' }"
    >
      <slot />
    </div>
    <div v-if="help" class="form-tip">{{ help }}</div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  label: string
  help?: string
}>()

const enabled = defineModel<boolean>({ required: true })
</script>

<style lang="scss" scoped>
.filter-rule-row {
  margin-bottom: 16px;

  &__head {
    margin-bottom: 6px;
  }

  &__slot {
    transition: opacity 0.15s ease;
  }

  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
    line-height: 1.4;
  }
}
</style>
