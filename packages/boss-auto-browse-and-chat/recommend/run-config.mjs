import { generateRubricFromJd } from '../llm-rubric.mjs'
import { warn as logWarn } from '../logger.mjs'
import { readConfigFile, getMergedJobConfig } from '../runtime-file-utils.mjs'

/**
 * 构建推荐页运行配置 + LLM 评分函数。从 index.mjs 抽出，供正式运行与调试 dry-run 共用。
 * 不含 canvasHook（运行期/页面相关），调用方拿到 recCfg 后自行 recCfg.canvasHook = ...。
 * @param {{ config:object, recommendPageOpts:object, filterConfig:object, maxChatPerRun:number }} args
 * @returns {Promise<{ recCfg:object, recLlmFn:(Function|undefined) }>}
 */
export async function buildRecommendCfgAndLlm ({ config, recommendPageOpts, filterConfig, maxChatPerRun }) {
  const recCfg = {
    ...(recommendPageOpts || {}),
    rules: filterConfig,
    fieldRules: filterConfig?.fieldRules || {},
    schoolFloorRank: filterConfig?.schoolFloorRank ?? 0,
    nativeFilter: filterConfig?.nativeFilter,
    waveSize: recommendPageOpts.waveSize ?? 6,
    maxGreetPerRun: recommendPageOpts.maxGreetPerRun ?? maxChatPerRun,
    maxViewPerRun: recommendPageOpts.maxViewPerRun ?? 20,
    maxXPerRun: recommendPageOpts.maxXPerRun ?? 10,
    maxScrollSteps: recommendPageOpts.maxScrollSteps ?? 6,
    maxStaleWaves: recommendPageOpts.maxStaleWaves ?? 2,
    scrollDelayMsRange: recommendPageOpts.scrollDelayMsRange ?? [800, 2000],
    delayBetweenActionsMs: recommendPageOpts.delayBetweenActionsMs ?? [1500, 4000],
    minScoreToChat: config?.scoring?.minScoreToChat ?? 0,
    onScoreError: config?.scoring?.onScoreError ?? 'skip',
    scoreConcurrency: recommendPageOpts.scoreConcurrency ?? 4,
    scoreMaxAttempts: recommendPageOpts.scoreMaxAttempts ?? 3,
    llm: {}
  }
  const scoringCfg = config?.scoring || {}
  let recLlmFn
  if (scoringCfg.enabled) {
    let rubric = scoringCfg.rubric || null
    if (!rubric && scoringCfg.jd) {
      try {
        rubric = (await generateRubricFromJd(scoringCfg.jd, { modelId: scoringCfg.modelId ?? null })).rubric
      } catch (e) {
        logWarn('[boss-auto-browse] 生成评分 rubric 失败，回退规则-only:', e?.message)
        rubric = null
      }
    }
    if (rubric) {
      recCfg.llm = { rubric, modelId: scoringCfg.modelId ?? null }
      recLlmFn = undefined
      // 打招呼门与 rubric.passThreshold 对齐（用户显式配的 minScoreToChat 优先）；
      // scorer-gate 的失败兜底也用同一个 minScoreToChat，保证失败时一致 fail-closed。
      const explicitMin = config?.scoring?.minScoreToChat
      if (rubric && typeof rubric.passThreshold === 'number' && explicitMin == null) {
        recCfg.minScoreToChat = rubric.passThreshold
      }
    } else {
      logWarn('[boss-auto-browse] 评分已启用但无 rubric/JD，回退规则-only')
      recLlmFn = async () => ({ score: recCfg.minScoreToChat })
    }
  } else {
    recLlmFn = async () => ({ score: recCfg.minScoreToChat })
  }
  return { recCfg, recLlmFn }
}

/**
 * 读取推荐页运行所需配置（boss-recruiter.json + per-job 或 candidate-filter.json）。
 * 供调试 dry-run 复用 index.mjs 的读取口径。
 * @param {string} [jobId]
 * @returns {{ config:object, filterConfig:object, recommendPageOpts:object, maxChatPerRun:number }}
 */
export function readRecommendConfig (jobId) {
  const baseConfig = readConfigFile('boss-recruiter.json') || {}
  const config = jobId
    ? getMergedJobConfig(jobId)
    : { ...baseConfig, candidateFilter: readConfigFile('candidate-filter.json') || {} }
  let filterConfig = config.candidateFilter || readConfigFile('candidate-filter.json') || {}
  const recommendPageOpts = config?.recommendPage || baseConfig?.recommendPage || {}
  filterConfig = {
    ...filterConfig,
    skipViewedCandidates: recommendPageOpts.skipViewedCandidates ?? filterConfig.skipViewedCandidates
  }
  const maxChatPerRun = config?.autoChat?.maxChatPerRun ?? 50
  return { config, filterConfig, recommendPageOpts, maxChatPerRun }
}
