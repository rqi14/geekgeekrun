/**
 * llm-rubric.mjs
 *
 * LLM-based resume evaluation using Rubric (knockouts + dimensions).
 * Used when resumeLlmConfig.rubric is present in job filter.
 */

import { readBossLlmConfig } from './runtime-file-utils.mjs'
import { debug as logDebug, info as logInfo, error as logError } from './logger.mjs'

const RESUME_TEXT_MAX_CHARS = 3500
const LOG = '[llm-rubric]'

const RESUME_SCREENING_MAX_TOKENS = 500
const RUBRIC_GENERATION_MAX_TOKENS = 2000

// 测试缝：默认用真实新层，测试可注入
let _chatCompleteForPurpose = null
export function __setChatCompleteForPurpose (fn) { _chatCompleteForPurpose = fn }
async function callLayer (config, purpose, messages, opts) {
  if (_chatCompleteForPurpose) return _chatCompleteForPurpose(config, purpose, messages, opts)
  const { chatCompleteForPurpose } = await import('./llm/failover.mjs')
  return chatCompleteForPurpose(config, purpose, messages, opts)
}

/**
 * 根据 Rubric 评估简历。
 * @param {string} resumeText - 简历全文
 * @param {{ knockouts?: string[], dimensions?: Array<{ name: string, weight: number, criteria: Record<string, string> }>, passThreshold?: number, _scoring_note?: string }} rubricConfig
 * @param {{ modelId?: string | null }} [options]
 * @returns {Promise<{ isPassed: boolean, totalScore: number, reason: string }>} 失败时默认通过
 */
export async function evaluateResumeByRubric (resumeText, rubricConfig, options = {}) {
  const defaultResult = { isPassed: true, totalScore: 0, reason: 'LLM 调用失败，默认通过' }
  // options.modelId：用户显式选定模型，置于 failover 链首（仍保留其余模型兜底）
  const preferModelId = typeof options?.modelId === 'string' ? options.modelId : null
  const knockouts = Array.isArray(rubricConfig?.knockouts) ? rubricConfig.knockouts : []
  const dimensions = Array.isArray(rubricConfig?.dimensions) ? rubricConfig.dimensions : []
  const passThreshold = typeof rubricConfig?.passThreshold === 'number' ? rubricConfig.passThreshold : 75
  const scoringNote = typeof rubricConfig?._scoring_note === 'string' ? rubricConfig._scoring_note : null

  if (dimensions.length === 0) {
    return { isPassed: true, totalScore: 100, reason: '无评分维度，默认通过' }
  }

  const truncatedResume = (resumeText || '（无简历内容）').slice(0, RESUME_TEXT_MAX_CHARS)

  const dimensionsDesc = dimensions
    .map((d) => {
      const criteriaStr = Object.entries(d.criteria || {})
        .map(([k, v]) => `${k}分: ${v}`)
        .join('；')
      return `- ${d.name}（权重${d.weight}%）：${criteriaStr}`
    })
    .join('\n')

  let systemContent = `你是一个招聘筛选助手。请根据以下评分标准对候选人简历进行结构化评估。

【一票否决项】若简历不满足以下任一项，直接返回 knockout_failed: true，无需计算维度分：
${knockouts.length > 0 ? knockouts.map((k) => `- ${k}`).join('\n') : '（无）'}

【评分维度】每个维度打 1/3/5 分，按权重加权得到总分（满100）：
${dimensionsDesc}

请仅以 JSON 格式回复，不要包含其他内容。格式：
{
  "knockout_failed": true或false,
  "knockout_reason": "若不通过则填写原因，否则填空字符串",
  "dimension_scores": { "维度名": 1或3或5, ... },
  "reasoning": "简要判断理由"
}`

  if (scoringNote) {
    systemContent += `\n\n【评分说明】\n${scoringNote}`
  }

  const schema = {
    name: 'rubric_eval',
    schema: {
      type: 'object',
      required: ['knockout_failed', 'dimension_scores'],
      properties: {
        knockout_failed: { type: 'boolean' },
        knockout_reason: { type: 'string' },
        dimension_scores: { type: 'object' },
        reasoning: { type: 'string' }
      }
    }
  }
  try {
    logInfo(LOG, 'evaluateResumeByRubric start', {
      resumeChars: truncatedResume.length,
      dims: dimensions.length,
      knockouts: knockouts.length,
      passThreshold
    })
    const config = readBossLlmConfig()
    const result = await callLayer(config, 'resume_screening', [
      { role: 'system', content: systemContent },
      { role: 'user', content: truncatedResume }
    ], { schema, maxOutputTokens: RESUME_SCREENING_MAX_TOKENS, preferModelId })

    const parsed = result?.parsed
    logDebug(LOG, 'evaluateResumeByRubric parsed?', !!parsed)
    if (!parsed) return defaultResult

    if (parsed.knockout_failed === true) {
      return {
        isPassed: false,
        totalScore: 0,
        reason: String(parsed.knockout_reason || parsed.reasoning || '一票否决')
      }
    }

    const scores = parsed.dimension_scores || {}
    let weightedSum = 0
    let totalWeight = 0
    const dimensionResults = []
    for (const d of dimensions) {
      const score = scores[d.name]
      const num = typeof score === 'number' ? Math.min(5, Math.max(1, score)) : 3
      const weight = typeof d.weight === 'number' ? d.weight : 100 / dimensions.length
      weightedSum += (num / 5) * weight
      totalWeight += weight
      dimensionResults.push({ name: d.name, score: num, weight })
    }
    const totalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0
    const isPassed = totalScore >= passThreshold

    return {
      isPassed,
      totalScore,
      reason: String(parsed.reasoning || ''),
      dimensionResults
    }
  } catch (err) {
    logError(LOG, 'evaluateResumeByRubric error', err?.message || err)
    return { ...defaultResult, reason: `评估异常: ${err?.message || err}` }
  }
}

/**
 * 根据岗位描述（JD）生成 Rubric 结构。
 * @param {string} sourceJd - 岗位描述或招聘要求
 * @param {{ modelId?: string | null }} [options]
 * @returns {Promise<{ rubric: { knockouts: string[], dimensions: Array<{ name: string, weight: number, criteria: Record<string, string> }> } }>}
 */
export async function generateRubricFromJd (sourceJd, options = {}) {
  const defaultRubric = {
    knockouts: [],
    dimensions: [
      { name: '综合匹配度', weight: 100, criteria: { '1': '不符合', '3': '部分符合', '5': '完全符合' } }
    ]
  }
  // options.modelId：用户显式选定模型，置于 failover 链首
  const preferModelId = typeof options?.modelId === 'string' ? options.modelId : null
  const systemContent = `你是一个资深 HR，擅长将招聘需求转化为可量化的候选人评分体系（Rubric）。

请仔细阅读用户提供的岗位描述（JD），从中提取并生成：

1. knockouts（一票否决项）：
   - 不满足任意一项即直接淘汰
   - 数量：根据 JD 实际硬性要求决定，通常 2~4 条
   - 只写岗位明确说明的硬性条件（禁止背景、资质门槛、明确排除项等），不要臆造
   - 每条独立，简洁具体，不超过 30 字

2. dimensions（评分维度）：
   - 数量：根据 JD 核心能力要求决定，通常 3~5 个
   - 每个维度必须对应 JD 中一个独立的、具体的能力方向（如：实验操作能力、研究独立性、沟通表达能力、工具学习能力等）
   - 严禁出现「综合匹配度」「整体匹配」「岗位匹配度」等笼统无意义的维度名称
   - weight 之和必须精确等于 100
   - criteria 必须是具体的行为或成果描述，严禁使用「不符合/部分符合/完全符合」这类无意义模板：
     - "1"：候选人完全不具备该维度的能力或经验（举例说明具体缺失表现）
     - "3"：候选人具备基础能力，但深度或广度不足（举例说明具体不足之处）
     - "5"：候选人在该维度有突出表现，与岗位高度匹配（举例说明具体优秀表现）

仅以 JSON 格式回复，不要包含任何其他文字，不要有 markdown 代码块。格式：
{
  "knockouts": ["否决项1", "否决项2"],
  "dimensions": [
    {
      "name": "维度名称",
      "weight": 30,
      "criteria": {
        "1": "1分的具体行为描述",
        "3": "3分的具体行为描述",
        "5": "5分的具体行为描述"
      }
    }
  ]
}`

  const schema = {
    name: 'rubric_gen',
    schema: { type: 'object', required: ['dimensions'], properties: { knockouts: { type: 'array' }, dimensions: { type: 'array' } } }
  }
  try {
    logInfo(LOG, 'generateRubricFromJd start', { jdChars: String(sourceJd || '').length })
    const config = readBossLlmConfig()
    const result = await callLayer(config, 'rubric_generation', [
      { role: 'system', content: systemContent },
      { role: 'user', content: sourceJd || '（请输入岗位描述）' }
    ], { schema, maxOutputTokens: RUBRIC_GENERATION_MAX_TOKENS, preferModelId })
    const parsed = result?.parsed
    logDebug(LOG, 'generateRubricFromJd parsed?', !!parsed)
    if (!parsed) return { rubric: defaultRubric }

    const knockouts = Array.isArray(parsed.knockouts)
      ? parsed.knockouts.filter((k) => typeof k === 'string').slice(0, 5)
      : []
    let dimensions
    const dimList = Array.isArray(parsed.dimensions) ? parsed.dimensions : []
    const dimCount = Math.min(5, dimList.length) || 1
    dimensions = dimList
      .filter((d) => d && typeof d.name === 'string' && d.criteria && typeof d.criteria === 'object')
      .slice(0, 5)
      .map((d) => ({
        name: String(d.name),
        weight: typeof d.weight === 'number' ? Math.max(0, Math.min(100, d.weight)) : 100 / dimCount,
        criteria: {
          '1': String(d.criteria['1'] || d.criteria[1] || ''),
          '3': String(d.criteria['3'] || d.criteria[3] || ''),
          '5': String(d.criteria['5'] || d.criteria[5] || '')
        }
      }))
    if (dimensions.length === 0) dimensions = defaultRubric.dimensions

    // 归一化权重
    const totalWeight = dimensions.reduce((s, d) => s + (d.weight || 0), 0)
    if (totalWeight > 0) {
      dimensions = dimensions.map((d) => ({
        ...d,
        weight: Math.round((100 * (d.weight || 0)) / totalWeight)
      }))
    }

    return { rubric: { knockouts, dimensions } }
  } catch (err) {
    logError(LOG, 'generateRubricFromJd error', err?.message || err)
    return { rubric: defaultRubric }
  }
}
