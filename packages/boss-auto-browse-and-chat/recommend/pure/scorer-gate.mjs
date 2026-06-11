import { ruleFilterList } from './rule-filter.mjs'

/**
 * 评分前的硬规则门：作用在简历+列表合并数据上。硬不达标 → hardReject（进入 X），不调 LLM。
 * @returns {{result:'pass'} | {result:'hardReject', reason:string}}
 */
export function ruleGate (merged, ruleCfg) {
  const r = ruleFilterList(merged, ruleCfg)
  if (r.result === 'reject') return { result: 'hardReject', reason: r.reason }
  return { result: 'pass' }
}

/**
 * 合并规则门与 LLM 结果为最终判定。
 * @param {{result:string, reason?:string}} gate
 * @param {{score:number, reason?:string}|null} llm - null 表示 LLM 失败
 * @param {{minScoreToChat:number, onScoreError?:'skip'|'greetIfRulePass'}} cfg
 * @returns {{score:number, reason:string, hardReject:boolean}}
 */
export function mergeScore (gate, llm, cfg) {
  if (gate.result === 'hardReject') {
    return { score: 0, reason: gate.reason, hardReject: true }
  }
  if (llm == null) {
    const score = cfg.onScoreError === 'greetIfRulePass' ? cfg.minScoreToChat : Math.max(0, cfg.minScoreToChat - 1)
    return { score, reason: 'llm-error', hardReject: false }
  }
  return { score: llm.score, reason: llm.reason ?? '', hardReject: false }
}
