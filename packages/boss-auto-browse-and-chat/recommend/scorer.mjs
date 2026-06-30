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
  let llmThrew = false
  try {
    const fn = llmFn || defaultLlm
    llm = await fn({ candidate: merged, resume, llmCfg: cfg.llm || {} })
  } catch (e) {
    llm = null
    llmThrew = true
  }
  // llmError：调用抛错 或 评分器内部兜底（限流/解析失败）。两者一律按「LLM 失败」走 mergeScore 的
  // null 分支，由 onScoreError 决定分数：skip → minScoreToChat-1（必定低于门槛，fail-closed，不论 minScoreToChat
  // 取值都不会被误打招呼）；greetIfRulePass → minScoreToChat（允许 LLM 失败时按规则放行）。
  // llmError 标记仍保留，供并发重试队列判定与失败弹窗聚合。
  const errored = llmThrew || llm?.llmError === true
  const result = mergeScore({ result: 'pass' }, errored ? null : llm, cfg)
  if (errored) result.llmError = true
  return result
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
  return {
    score: typeof r.totalScore === 'number' ? r.totalScore : 0,
    reason: r.reason ?? '',
    llmError: r.llmError === true
  }
}

/** 把列表字段 + 简历概览拼成喂给评分器的简历文本 */
export function buildResumeText(candidate, resume) {
  const parts = [
    candidate?.geekName && `姓名：${candidate.geekName}`,
    candidate?.education && `学历：${candidate.education}`,
    candidate?.workExp && `经验：${candidate.workExp}`,
    candidate?.city && `期望城市：${candidate.city}`,
    candidate?.jobTitle && `期望行业：${candidate.jobTitle}`,
    candidate?.salary && `期望薪资：${candidate.salary}`,
    candidate?.skills && `优势：${candidate.skills}`,
    Array.isArray(candidate?.tags) && candidate.tags.length && `标签：${candidate.tags.join('、')}`,
    resume?.fullText
      ? `\n在线简历全文：\n${resume.fullText}`
      : resume?.summary && `\n经历概览：\n${resume.summary}`
  ].filter(Boolean)
  return parts.join('\n')
}
