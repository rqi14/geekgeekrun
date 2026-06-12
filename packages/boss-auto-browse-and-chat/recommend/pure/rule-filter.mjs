import { filterCandidates } from '../../candidate-processor.mjs'

/**
 * 单个候选人的列表硬规则初筛。复用现有 filterCandidates（批处理）的全部规则与 reason 体系。
 * @param {object} candidate - 含 encryptGeekId/geekName/education/workExp/city/salary/skills 的归一化卡片
 * @param {object} ruleCfg - candidate-filter 配置形状
 * @returns {{result:'pass'} | {result:'reject', reason:string, reasonDetail?:string}}
 */
export function ruleFilterList (candidate, ruleCfg) {
  const { matched, skipped } = filterCandidates([candidate], ruleCfg || {})
  if (matched.length) return { result: 'pass' }
  const fr = skipped[0]?.filterResult
  return { result: 'reject', reason: fr?.reason ?? 'skills', reasonDetail: fr?.reasonDetail }
}
