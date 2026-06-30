/**
 * 推荐页原生「筛选」面板的纯逻辑层：选项目录 + 文案归一 + 计划生成。
 * 无 IO、确定可测。VIP 门禁不在此判断（运行期才知道），由 driver 决定。
 */

/** 唯一的文案归一：去掉全部空白（含中间换行）。planner 校验与 driver 读 DOM 必须共用此函数。 */
export function normalizeOption (s) {
  return String(s ?? '').replace(/\s+/g, '')
}

/**
 * 选项目录 = 合法值的唯一真相来源。options/single/vip 均按实测 filter-panel HTML 核定。
 * single 依面板 [单选] 标记：活跃度/跳槽频率/薪资为单选，其余多选。
 * options:null 表示动态（按职位变，如专业大类），planner 不静态校验，交 driver 运行期回读。
 * 年龄（vue-slider）交互方式不同，v1 不纳入。
 */
export const NATIVE_FILTER_CATALOG = {
  // 免费维度
  degree: { groupClass: 'degree', vip: false, single: false, options: ['初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'] },
  experience: { groupClass: 'experience', vip: false, single: false, options: ['在校/应届', '25年毕业', '26年毕业', '26年后毕业', '1年以内', '1-3年', '3-5年', '5-10年', '10年以上'] },
  intention: { groupClass: 'intention', vip: false, single: false, options: ['离职-随时到岗', '在职-暂不考虑', '在职-考虑机会', '在职-月内到岗'] },
  salary: { groupClass: 'salary', vip: false, single: true, options: ['3K以下', '3-5K', '5-10K', '10-20K', '20-50K', '50K以上'] },
  // VIP 维度（高级筛选）
  activation: { groupClass: 'activation', vip: true, single: true, options: ['刚刚活跃', '今日活跃', '3日内活跃', '本周活跃', '本月活跃'] },
  gender: { groupClass: 'gender', vip: true, single: false, options: ['男', '女'] },
  school: { groupClass: 'school', vip: true, single: false, options: ['985', '211', '双一流院校', '留学', '国内外名校', '公办本科'] },
  major: { groupClass: 'major', vip: true, single: false, options: null },
  switchJobFrequency: { groupClass: 'switchJobFrequency', vip: true, single: true, options: ['5年少于3份', '平均每份工作大于1年'] },
  exchangeResumeWithColleague: { groupClass: 'exchangeResumeWithColleague', vip: true, single: false, options: ['近一个月没有'] },
  recentNotView: { groupClass: 'recentNotView', vip: true, single: false, options: ['近14天没有'] }
}

/** catalog 里 vip:true 的组名集合，供 driver 判断是否需要展开折叠区 / VIP 锁。 */
export const VIP_GROUPS = new Set(
  Object.entries(NATIVE_FILTER_CATALOG).filter(([, m]) => m.vip).map(([g]) => g)
)

/**
 * 把 nativeFilter 配置解析成可执行计划。纯函数、VIP 无关。
 * @param {object|undefined} cfg - candidate-filter.json 的 nativeFilter 块
 * @param {object} [catalog] - 默认生产 catalog；单测注入 fixture
 * @returns {{apply: Array<{group:string,single:boolean,options:string[]}>, skipped: Array<{group:string,value:any,reason:string}>}}
 */
export function planNativeFilter (cfg, catalog = NATIVE_FILTER_CATALOG) {
  const apply = []
  const skipped = []
  if (!cfg || typeof cfg !== 'object' || cfg.enabled === false) return { apply, skipped }

  for (const [group, meta] of Object.entries(catalog)) {
    const raw = cfg[group]
    let values = raw == null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw])
    values = values.filter((v) => v != null && String(v).trim() !== '')
    if (meta.single) values = values.slice(0, 1)
    if (!values.length) continue // 空值：既不 apply 也不 skipped

    if (meta.options === null) {
      // 动态维度（如 major）：原样透传，运行期由 driver 回读校验
      apply.push({ group, single: meta.single, options: values.map((v) => String(v)) })
      continue
    }

    const matched = []
    for (const v of values) {
      const hit = meta.options.find((o) => normalizeOption(o) === normalizeOption(v))
      if (hit) matched.push(hit) // 存原始 catalog 文案
      else skipped.push({ group, value: v, reason: 'unknown-option' })
    }
    if (matched.length) apply.push({ group, single: meta.single, options: matched })
  }
  return { apply, skipped }
}
