/**
 * 在「不感兴趣」原因弹窗动态出现的选项里，按候选人真实属性自动分类、挑最贴切的一项。
 * 选项随候选人/职位变化（如「不考虑硕士」「期望薪资偏高」「重复推荐」「与职位不符」「其他原因」…），
 * 这里用候选人字段去匹配选项语义，挑置信度最高的一项；避开「其他原因」(它需要填输入框才能提交)。
 *
 * 纯函数，可单测。不命中具体信号时退回「与职位不符」类通用项，再退回第一个具体项。
 *
 * @param {object} candidate - scrapeCards 的卡片对象（education/age/workExp/_hasViewed/city/salary…）
 * @param {string[]} optionTexts - 弹窗里实际出现的选项文案
 * @returns {{ reason: string|null, index: number, basis: string, scored: Array<{o:string,s:number,basis:string}> }}
 */
export function classifyRejectReason (candidate = {}, optionTexts = []) {
  const all = Array.isArray(optionTexts) ? optionTexts.filter((o) => typeof o === 'string' && o.trim()) : []
  const concrete = all.filter((o) => !/其他/.test(o))
  const pool = concrete.length ? concrete : all
  if (!pool.length) return { reason: null, index: -1, basis: 'no-options', scored: [] }

  const edu = String(candidate.education || '')
  const viewed = candidate._hasViewed === true
  const ageNum = parseInt(String(candidate.age || ''), 10)
  const hasWorkExp = !!candidate.workExp

  const scored = pool.map((o) => {
    let s = 0.05 // 基础分，保证总有一项可选
    let basis = 'generic'

    // 学历：选项「不考虑X」且候选人正是该学历 → 最高置信
    const degMatch = o.match(/不考虑\s*(本科|硕士|博士|大专|专科|博士后)/)
    if (degMatch && edu.includes(degMatch[1])) { s += 5; basis = 'education' }

    // 重复推荐：候选人已被看过
    if (/重复推荐|重复/.test(o) && viewed) { s += 4; basis = 'viewed' }

    // 年龄：仅当年龄偏大/偏小时该理由才贴切
    if (/年龄/.test(o)) {
      if (Number.isFinite(ageNum) && (ageNum >= 35 || ageNum <= 20)) { s += 3; if (basis === 'generic') basis = 'age' }
      else s += 0.2
    }

    // 经验/工作经历：无工作经验时更贴切
    if (/经验|工作经历|资历|年限/.test(o)) {
      if (!hasWorkExp) { s += 1.5; if (basis === 'generic') basis = 'workExp' }
      else s += 0.5
    }

    // 通用「与职位不符 / 方向 / 专业」：总是合理的兜底理由
    if (/不符|与职位|不合适|不匹配|方向|专业|岗位/.test(o)) { s += 1; if (basis === 'generic') basis = 'mismatch' }

    // 薪资 / 异地 / 活跃度：缺目标信息，低权重（除非有更强信号否则不优先）
    if (/薪资|薪酬|期望/.test(o)) s += 0.3
    if (/异地|距离|城市|地区|通勤/.test(o)) s += 0.3
    if (/活跃/.test(o)) s += 0.2

    return { o, s, basis }
  })

  scored.sort((a, b) => b.s - a.s)
  const best = scored[0]
  return { reason: best.o, index: all.indexOf(best.o), basis: best.basis, scored }
}
