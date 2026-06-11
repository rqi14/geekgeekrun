import { ruleGate, mergeScore } from './pure/scorer-gate.mjs'
import { evaluateResumeByRubric } from '../llm-rubric.mjs'

/**
 * 给候选人打分：先规则门（硬不达标→hardReject，不调 LLM），否则调 LLM（可注入便于测试）。
 * @param {object} merged - 列表+简历合并后的候选数据（含 education/workExp/salary/...）
 * @param {{summary?:string}} resume - 简历弹窗读到的文本
 * @param {{rules?:object, minScoreToChat:number, onScoreError?:'skip'|'greetIfRulePass', llm?:object}} cfg
 * @param {(payload:{candidate:object,resume:object,llmCfg:object})=>Promise<{score:number,reason?:string}>} [llmFn]
 * @returns {Promise<{score:number, reason:string, hardReject:boolean}>}
 */
export async function score(merged, resume, cfg, llmFn) {
  const gate = ruleGate(merged, cfg.rules || {})
  if (gate.result === 'hardReject') return mergeScore(gate, null, cfg)
  let llm = null
  try {
    const fn = llmFn || defaultLlm
    llm = await fn({ candidate: merged, resume, llmCfg: cfg.llm || {} })
  } catch (e) {
    llm = null
  }
  return mergeScore({ result: 'pass' }, llm, cfg)
}

/**
 * 默认 LLM 适配器：复用 evaluateResumeByRubric。需要 llmCfg.rubric（调用方每次运行预先用 generateRubricFromJd 生成一次再传入）。
 * 无 rubric 时返回 null（交给 mergeScore + onScoreError 处理）。
 * @returns {Promise<{score:number, reason:string}|null>}
 */
export async function defaultLlm({ candidate, resume, llmCfg }) {
  const rubric = llmCfg?.rubric
  if (!rubric) return null
  const resumeText = buildResumeText(candidate, resume)
  const r = await evaluateResumeByRubric(resumeText, rubric, { modelId: llmCfg?.modelId ?? null })
  if (!r) return null
  return { score: typeof r.totalScore === 'number' ? r.totalScore : 0, reason: r.reason ?? '' }
}

/** 把列表字段 + 简历概览拼成喂给评分器的简历文本 */
export function buildResumeText(candidate, resume) {
  const parts = [
    candidate?.geekName && `姓名：${candidate.geekName}`,
    candidate?.education && `学历：${candidate.education}`,
    candidate?.workExp && `经验：${candidate.workExp}`,
    candidate?.city && `期望城市：${candidate.city}`,
    candidate?.jobTitle && `期望职位：${candidate.jobTitle}`,
    candidate?.salary && `期望薪资：${candidate.salary}`,
    candidate?.skills && `优势：${candidate.skills}`,
    Array.isArray(candidate?.tags) && candidate.tags.length && `标签：${candidate.tags.join('、')}`,
    resume?.summary && `\n经历概览：\n${resume.summary}`
  ].filter(Boolean)
  return parts.join('\n')
}
