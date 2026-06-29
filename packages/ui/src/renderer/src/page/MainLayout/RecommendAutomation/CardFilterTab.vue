<template>
  <el-form label-position="top">
    <el-alert
      class="mb12"
      type="info"
      :closable="false"
      show-icon
      title="此处为「未选择职位」时的全局兜底卡片初筛"
    >
      按职位运行时，卡片初筛以「职位配置 → 卡片初筛」为准（每个职位各自独立）。
      请优先在「职位配置」里配置；此页仅在不区分职位时生效。
    </el-alert>
    <el-alert
      class="mb16"
      type="success"
      :closable="false"
      title="命中初筛即直接 X，省下一次开简历（动作更少、更安全）。"
    />

    <el-card class="config-section">
      <FilterRuleRow v-model="cityEnabled" label="城市" help="多个城市用逗号分隔">
        <el-input v-model="cityStr" placeholder="如：北京,上海,深圳" />
      </FilterRuleRow>

      <FilterRuleRow
        v-model="educationEnabled"
        label="学历（正则）"
        help="按正则匹配学历文本；可用下方快填"
      >
        <el-input v-model="model.expectEducationRegExpStr" placeholder="如：本科|硕士|博士" />
        <div class="quick-fill">
          <el-button size="small" @click="model.expectEducationRegExpStr = '本科|硕士|博士'">
            本科+
          </el-button>
          <el-button size="small" @click="model.expectEducationRegExpStr = '硕士|博士'">
            硕士+
          </el-button>
          <el-button size="small" @click="model.expectEducationRegExpStr = '博士'">
            博士
          </el-button>
        </div>
        <div v-if="educationRegexError" class="form-error">正则无效：{{ educationRegexError }}</div>
      </FilterRuleRow>

      <FilterRuleRow v-model="workExpEnabled" label="工作年限" help="单位：年">
        <div class="range-input-wrap">
          <el-input-number
            v-model="model.expectWorkExpRange[0]"
            :min="0"
            :value-on-clear="0"
            controls-position="right"
            placeholder="最小"
          />
          <span class="range-sep">~</span>
          <el-input-number
            v-model="model.expectWorkExpRange[1]"
            :min="0"
            :value-on-clear="99"
            controls-position="right"
            placeholder="最大"
          />
        </div>
      </FilterRuleRow>

      <FilterRuleRow v-model="salaryEnabled" label="期望薪资" help="单位：K（千元/月）">
        <div class="range-input-wrap">
          <el-input-number
            v-model="model.expectSalaryRange[0]"
            :min="0"
            :value-on-clear="0"
            controls-position="right"
            placeholder="最小"
          />
          <span class="range-sep">~</span>
          <el-input-number
            v-model="model.expectSalaryRange[1]"
            :min="0"
            :value-on-clear="0"
            controls-position="right"
            placeholder="最大"
          />
        </div>
        <div class="negotiable-wrap">
          <span class="negotiable-label">薪资面议时</span>
          <el-radio-group v-model="model.expectSalaryWhenNegotiable">
            <el-radio value="include">视为命中</el-radio>
            <el-radio value="exclude">视为未命中</el-radio>
          </el-radio-group>
        </div>
      </FilterRuleRow>

      <FilterRuleRow
        v-model="skillEnabled"
        label="关键词（优势）"
        help="命中任一关键词即通过；多个用逗号分隔"
      >
        <el-input v-model="skillStr" placeholder="如：LC-MS,质谱,色谱" />
      </FilterRuleRow>

      <FilterRuleRow
        v-model="schoolEnabled"
        label="院校"
        help="可填 双一流/QS/985/211 档次标签 或 具体学校名；缺数据按未命中。多个用逗号分隔"
      >
        <el-input v-model="schoolStr" placeholder="如：双一流,985,清华大学" />
      </FilterRuleRow>

      <FilterRuleRow v-model="majorEnabled" label="专业" help="命中专业子串即通过；多个用逗号分隔">
        <el-input v-model="majorStr" placeholder="如：食品,化学,生物" />
      </FilterRuleRow>

      <FilterRuleRow
        v-model="blockNameEnabled"
        label="屏蔽姓名（正则）"
        help="姓名匹配该正则的候选人将被屏蔽"
      >
        <el-input v-model="model.blockCandidateNameRegExpStr" placeholder="如：^张" />
        <div v-if="blockNameRegexError" class="form-error">正则无效：{{ blockNameRegexError }}</div>
      </FilterRuleRow>

      <el-form-item class="mt8">
        <el-checkbox v-model="model.skipViewedCandidates">
          跳过已看过的候选人（带 has-viewed 标记）
        </el-checkbox>
      </el-form-item>
    </el-card>
  </el-form>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import FilterRuleRow from './FilterRuleRow.vue'
import type { FilterState } from './mapping'

const model = defineModel<FilterState>({ required: true })

// ── comma-string <-> array helpers ───────────────────────────────────────────
const toStr = (arr: string[]) => (Array.isArray(arr) ? arr.join(',') : '')
const toArr = (str: string) =>
  str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const makeCommaModel = (
  key: 'expectCityList' | 'expectSkillKeywords' | 'expectSchoolKeywords' | 'expectMajorKeywords'
) =>
  computed<string>({
    get: () => toStr(model.value[key]),
    set: (v) => {
      model.value[key] = toArr(v)
    }
  })

const cityStr = makeCommaModel('expectCityList')
const skillStr = makeCommaModel('expectSkillKeywords')
const schoolStr = makeCommaModel('expectSchoolKeywords')
const majorStr = makeCommaModel('expectMajorKeywords')

// ── enable toggles (local). Off => clear the field so orchestrator ignores it ─
const cityEnabled = ref(model.value.expectCityList.length > 0)
const educationEnabled = ref(model.value.expectEducationRegExpStr.length > 0)
const workExpEnabled = ref(
  !(model.value.expectWorkExpRange[0] === 0 && model.value.expectWorkExpRange[1] === 99)
)
const salaryEnabled = ref(
  !(model.value.expectSalaryRange[0] === 0 && model.value.expectSalaryRange[1] === 0)
)
const skillEnabled = ref(model.value.expectSkillKeywords.length > 0)
const schoolEnabled = ref(model.value.expectSchoolKeywords.length > 0)
const majorEnabled = ref(model.value.expectMajorKeywords.length > 0)
const blockNameEnabled = ref(model.value.blockCandidateNameRegExpStr.length > 0)

watch(cityEnabled, (on) => {
  if (!on) model.value.expectCityList = []
})
watch(educationEnabled, (on) => {
  if (!on) model.value.expectEducationRegExpStr = ''
})
watch(workExpEnabled, (on) => {
  if (!on) model.value.expectWorkExpRange = [0, 99]
})
watch(salaryEnabled, (on) => {
  if (!on) model.value.expectSalaryRange = [0, 0]
})
watch(skillEnabled, (on) => {
  if (!on) model.value.expectSkillKeywords = []
})
watch(schoolEnabled, (on) => {
  if (!on) model.value.expectSchoolKeywords = []
})
watch(majorEnabled, (on) => {
  if (!on) model.value.expectMajorKeywords = []
})
watch(blockNameEnabled, (on) => {
  if (!on) model.value.blockCandidateNameRegExpStr = ''
})

// ── regex validation ─────────────────────────────────────────────────────────
const regexError = (v: string) => {
  if (!v) return ''
  try {
    // eslint-disable-next-line no-new
    new RegExp(v)
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
const educationRegexError = computed(() => regexError(model.value.expectEducationRegExpStr))
const blockNameRegexError = computed(() => regexError(model.value.blockCandidateNameRegExpStr))
</script>

<style lang="scss" scoped>
.config-section {
  margin-bottom: 16px;
}

.mb16 {
  margin-bottom: 16px;
}

.mt8 {
  margin-top: 8px;
}

.quick-fill {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.range-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;

  .range-sep {
    color: #999;
  }
}

.negotiable-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;

  .negotiable-label {
    font-size: 13px;
    color: #606266;
  }
}

.form-error {
  font-size: 12px;
  color: #f56c6c;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
