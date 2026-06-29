import fs from 'node:fs'
import fsPromise from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const defaultBossRecruiterConf = require('./default-config-file/boss-recruiter.json')
const defaultCandidateFilterConf = require('./default-config-file/candidate-filter.json')
const defaultBossCookieStorage = require('./default-storage-file/boss-cookies.json')
const defaultBossLocalStorageStorage = require('./default-storage-file/boss-local-storage.json')

export const configFileNameList = ['boss-recruiter.json', 'candidate-filter.json']

const defaultConfigFileContentMap = {
  'boss-recruiter.json': JSON.stringify(defaultBossRecruiterConf),
  'candidate-filter.json': JSON.stringify(defaultCandidateFilterConf)
}

const runtimeFolderPath = path.join(os.homedir(), '.geekgeekrun')
export const configFolderPath = path.join(runtimeFolderPath, 'config')

export const writeConfigFile = async (fileName, content, { isSync } = {}) => {
  const filePath = path.join(configFolderPath, fileName)
  const fileContent = JSON.stringify(content)
  if (isSync) {
    fs.writeFileSync(filePath, fileContent)
  } else {
    return fsPromise.writeFile(filePath, fileContent)
  }
}

const ensureRuntimeFolderPathExist = () => {
  if (!fs.existsSync(runtimeFolderPath)) {
    fs.mkdirSync(runtimeFolderPath)
  }
  ;['config', 'storage'].forEach(dirPath => {
    if (!fs.existsSync(path.join(runtimeFolderPath, dirPath))) {
      fs.mkdirSync(path.join(runtimeFolderPath, dirPath))
    }
  })
}

export const ensureConfigFileExist = () => {
  ensureRuntimeFolderPathExist()
  configFileNameList.forEach(fileName => {
    if (!fs.existsSync(path.join(configFolderPath, fileName))) {
      fs.writeFileSync(
        path.join(configFolderPath, fileName),
        defaultConfigFileContentMap[fileName]
      )
    }
  })
}

export const readConfigFile = (fileName) => {
  const joinedPath = path.join(configFolderPath, fileName)
  if (!fs.existsSync(joinedPath)) {
    ensureConfigFileExist()
  }

  let o
  try {
    o = JSON.parse(fs.readFileSync(joinedPath))
  } catch {
    if (fs.existsSync(joinedPath)) fs.unlinkSync(joinedPath)
    if (defaultConfigFileContentMap[fileName]) {
      ensureConfigFileExist()
      o = JSON.parse(defaultConfigFileContentMap[fileName])
    } else {
      o = null
    }
  }

  return o
}

export const storageFilePath = path.join(runtimeFolderPath, 'storage')
export const storageFileNameList = ['boss-cookies.json', 'boss-local-storage.json']

const defaultStorageFileContentMap = {
  'boss-cookies.json': JSON.stringify(defaultBossCookieStorage),
  'boss-local-storage.json': JSON.stringify(defaultBossLocalStorageStorage)
}

export const ensureStorageFileExist = () => {
  ensureRuntimeFolderPathExist()
  storageFileNameList.forEach(fileName => {
    if (!fs.existsSync(path.join(storageFilePath, fileName))) {
      fs.writeFileSync(
        path.join(storageFilePath, fileName),
        defaultStorageFileContentMap[fileName]
      )
    }
  })
}

export const readStorageFile = (fileName, { isJson } = {}) => {
  isJson = isJson ?? true
  const joinedPath = path.join(storageFilePath, fileName)

  if (!fs.existsSync(joinedPath)) {
    ensureStorageFileExist()
  }

  let o
  try {
    const content = fs.readFileSync(joinedPath)
    if (isJson) {
      o = JSON.parse(content)
    } else {
      o = content.toString()
    }
  } catch {
    if (fs.existsSync(joinedPath)) fs.unlinkSync(joinedPath)
    ensureStorageFileExist()
    if (isJson) {
      o = JSON.parse(defaultStorageFileContentMap[fileName] ?? 'null')
    } else {
      o = defaultStorageFileContentMap[fileName] ?? null
    }
  }

  return o
}

export const writeStorageFile = async (fileName, content, { isJson } = {}) => {
  isJson = isJson ?? true
  const filePath = path.join(storageFilePath, fileName)
  let fileContent
  if (isJson) {
    fileContent = JSON.stringify(content)
  } else {
    fileContent = content
  }
  return fsPromise.writeFile(filePath, fileContent)
}

const bossJobsConfigFileName = 'boss-jobs-config.json'

/**
 * migrateJobFilter(filter) — 纯函数、幂等。把职位 filter 规整成四块结构：
 *   preFilter（共享卡片初筛）/ rubric（共享 AI 评分标准单一真源）/ recommend（推荐专属）/ chat（沟通专属）。
 * 同时兼容旧的扁平结构（resumeLlmEnabled / resumeLlmConfig / resumeKeywords / expect* 直接放在 filter 顶层）。
 * 取值优先级：新块字段 > 旧扁平字段 > 默认值。未知顶层键（如 schoolFloorRank 之外的）一并保留。
 *
 * 迁移关键：旧 `resumeLlmEnabled` 单开关同时映射到 recommend.scoringEnabled 与 chat.llmFilterEnabled，
 * 保持旧"二合一"行为不回归；之后用户可在 UI 分别关闭。
 */
export function migrateJobFilter (filter) {
  const f = filter && typeof filter === 'object' ? filter : {}
  const pf = f.preFilter && typeof f.preFilter === 'object' ? f.preFilter : {}
  const rb = f.rubric && typeof f.rubric === 'object' ? f.rubric : {}
  const rec = f.recommend && typeof f.recommend === 'object' ? f.recommend : {}
  const ch = f.chat && typeof f.chat === 'object' ? f.chat : {}
  const oldLlm = f.resumeLlmConfig && typeof f.resumeLlmConfig === 'object' ? f.resumeLlmConfig : {}
  const oldRubric = oldLlm.rubric && typeof oldLlm.rubric === 'object' ? oldLlm.rubric : {}

  const preFilter = {
    expectCityEnabled: pf.expectCityEnabled ?? f.expectCityEnabled ?? false,
    expectCityList: pf.expectCityList ?? f.expectCityList ?? [],
    expectEducationEnabled: pf.expectEducationEnabled ?? f.expectEducationEnabled ?? false,
    expectEducationRegExpStr: pf.expectEducationRegExpStr ?? f.expectEducationRegExpStr ?? '',
    expectWorkExpMinEnabled: pf.expectWorkExpMinEnabled ?? f.expectWorkExpMinEnabled ?? false,
    expectWorkExpMaxEnabled: pf.expectWorkExpMaxEnabled ?? f.expectWorkExpMaxEnabled ?? false,
    expectWorkExpRange: pf.expectWorkExpRange ?? f.expectWorkExpRange ?? [0, 99],
    expectSalaryMinEnabled: pf.expectSalaryMinEnabled ?? f.expectSalaryMinEnabled ?? false,
    expectSalaryMaxEnabled: pf.expectSalaryMaxEnabled ?? f.expectSalaryMaxEnabled ?? false,
    expectSalaryRange: pf.expectSalaryRange ?? f.expectSalaryRange ?? [0, 0],
    expectSalaryWhenNegotiable: pf.expectSalaryWhenNegotiable ?? f.expectSalaryWhenNegotiable ?? 'exclude',
    expectSkillKeywords: pf.expectSkillKeywords ?? f.expectSkillKeywords ?? [],
    expectSchoolKeywords: pf.expectSchoolKeywords ?? f.expectSchoolKeywords ?? [],
    expectMajorKeywords: pf.expectMajorKeywords ?? f.expectMajorKeywords ?? [],
    blockCandidateNameRegExpStr: pf.blockCandidateNameRegExpStr ?? f.blockCandidateNameRegExpStr ?? '',
    fieldRules: pf.fieldRules ?? f.fieldRules ?? { include: [], exclude: [] },
    schoolFloorRank: pf.schoolFloorRank ?? f.schoolFloorRank ?? null,
    nativeFilter: pf.nativeFilter ?? f.nativeFilter ?? null
  }

  const rubric = {
    sourceJd: rb.sourceJd ?? oldLlm.sourceJd ?? '',
    modelId: rb.modelId ?? oldLlm.rubricGenerationModelId ?? null,
    passThreshold: rb.passThreshold ?? oldLlm.passThreshold ?? oldRubric.passThreshold ?? 75,
    knockouts: rb.knockouts ?? oldRubric.knockouts ?? [],
    dimensions: rb.dimensions ?? oldRubric.dimensions ?? []
  }

  const recommend = {
    scoringEnabled: rec.scoringEnabled ?? f.resumeLlmEnabled ?? false,
    minScoreToChat: rec.minScoreToChat ?? f.minScoreToChat ?? null,
    onScoreError: rec.onScoreError ?? f.onScoreError ?? 'skip',
    skipViewedCandidates: rec.skipViewedCandidates ?? f.skipViewedCandidates ?? false
  }

  const chat = {
    llmFilterEnabled: ch.llmFilterEnabled ?? f.resumeLlmEnabled ?? false,
    keywordsEnabled: ch.keywordsEnabled ?? f.resumeKeywordsEnabled ?? false,
    keywords: ch.keywords ?? f.resumeKeywords ?? [],
    regexEnabled: ch.regexEnabled ?? f.resumeRegExpEnabled ?? false,
    regex: ch.regex ?? f.resumeRegExpStr ?? ''
  }

  // 保留未知顶层键；剥离已迁入块的旧扁平键，避免新旧并存引发歧义
  const migratedAwayKeys = new Set([
    'preFilter', 'rubric', 'recommend', 'chat',
    'resumeLlmEnabled', 'resumeLlmConfig', 'resumeKeywordsEnabled', 'resumeKeywords',
    'resumeRegExpEnabled', 'resumeRegExpStr',
    'expectCityEnabled', 'expectCityList', 'expectEducationEnabled', 'expectEducationRegExpStr',
    'expectWorkExpMinEnabled', 'expectWorkExpMaxEnabled', 'expectWorkExpRange',
    'expectSalaryMinEnabled', 'expectSalaryMaxEnabled', 'expectSalaryRange', 'expectSalaryWhenNegotiable',
    'expectSkillKeywords', 'expectSchoolKeywords', 'expectMajorKeywords', 'blockCandidateNameRegExpStr',
    'fieldRules', 'schoolFloorRank', 'nativeFilter',
    'minScoreToChat', 'onScoreError', 'skipViewedCandidates'
  ])
  const preserved = {}
  for (const k of Object.keys(f)) {
    if (!migratedAwayKeys.has(k)) {
      preserved[k] = f[k]
    }
  }

  return { ...preserved, preFilter, rubric, recommend, chat }
}

export const readBossJobsConfig = () => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossJobsConfigFileName)
  if (!fs.existsSync(filePath)) {
    return { jobs: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return { jobs: [] }
  }
  // 读取时把每个职位的 filter 规整成四块结构（幂等）；若有变化原子写回，旧用户零感知升级。
  if (parsed && Array.isArray(parsed.jobs)) {
    let changed = false
    const before = JSON.stringify(parsed)
    parsed.jobs = parsed.jobs.map((job) => {
      if (!job || typeof job !== 'object') return job
      return { ...job, filter: migrateJobFilter(job.filter) }
    })
    if (JSON.stringify(parsed) !== before) changed = true
    if (changed) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(parsed))
      } catch {
        // 写回失败不致命：本次仍用已迁移的内存结构
      }
    }
  }
  return parsed
}

export const writeBossJobsConfig = async (config) => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossJobsConfigFileName)
  return fsPromise.writeFile(filePath, JSON.stringify(config))
}

/**
 * 将 boss-jobs-config 的 filter（含 *Enabled 字段）转换为 candidate-filter 格式，
 * 供 filterCandidates / 推荐页 / 沟通页 preFilter 使用。
 */
function jobFilterToCandidateFilter (jobFilter) {
  if (!jobFilter || typeof jobFilter !== 'object') {
    return {}
  }
  // 规整成四块结构后从 preFilter / recommend 取值（兼容旧扁平输入）
  const m = migrateJobFilter(jobFilter)
  const f = m.preFilter
  const expectCityList = f.expectCityEnabled && Array.isArray(f.expectCityList)
    ? f.expectCityList
    : []
  const expectEducationRegExpStr = f.expectEducationEnabled && typeof f.expectEducationRegExpStr === 'string'
    ? f.expectEducationRegExpStr
    : ''
  const [workMinDefault, workMaxDefault] = Array.isArray(f.expectWorkExpRange) && f.expectWorkExpRange.length >= 2
    ? f.expectWorkExpRange
    : [0, 99]
  const expectWorkExpRange = [
    f.expectWorkExpMinEnabled ? workMinDefault : 0,
    f.expectWorkExpMaxEnabled ? workMaxDefault : 99
  ]
  const [salMinDefault, salMaxDefault] = Array.isArray(f.expectSalaryRange) && f.expectSalaryRange.length >= 2
    ? f.expectSalaryRange
    : [0, 0]
  const expectSalaryRange = [
    f.expectSalaryMinEnabled ? salMinDefault : 0,
    f.expectSalaryMaxEnabled ? salMaxDefault : 0
  ]
  return {
    expectCityList,
    expectEducationRegExpStr,
    expectWorkExpRange,
    expectSalaryRange,
    expectSalaryWhenNegotiable: f.expectSalaryWhenNegotiable || 'exclude',
    expectSkillKeywords: Array.isArray(f.expectSkillKeywords) ? f.expectSkillKeywords : [],
    expectSchoolKeywords: Array.isArray(f.expectSchoolKeywords) ? f.expectSchoolKeywords : [],
    expectMajorKeywords: Array.isArray(f.expectMajorKeywords) ? f.expectMajorKeywords : [],
    blockCandidateNameRegExpStr:
      typeof f.blockCandidateNameRegExpStr === 'string' ? f.blockCandidateNameRegExpStr : '',
    skipViewedCandidates: m.recommend.skipViewedCandidates === true,
    nativeFilter: f.nativeFilter && typeof f.nativeFilter === 'object' ? f.nativeFilter : undefined
  }
}

// 测试别名（供 recommend/pure/job-filter-passthrough.test.mjs 使用）
export const __jobFilterToCandidateFilter = jobFilterToCandidateFilter
export const __jobFilterToChatPageFilter = jobFilterToChatPageFilter

/**
 * 将 boss-jobs-config 的 filter 转换为 chatPage.filter 格式（简历筛选）。
 * 优先级：resumeLlmEnabled（rubric）> resumeLlmEnabled（rule）> resumeKeywordsEnabled > resumeRegExpEnabled
 */
function jobFilterToChatPageFilter (jobFilter) {
  if (!jobFilter || typeof jobFilter !== 'object') {
    return { mode: 'keywords', keywordList: [], llmRule: '', llmConfig: null }
  }
  const m = migrateJobFilter(jobFilter)
  const chat = m.chat
  const rubric = m.rubric
  const hasRubric = Array.isArray(rubric.dimensions) && rubric.dimensions.length > 0

  // 沟通 LLM 筛选：只看 chat.llmFilterEnabled（与推荐评分独立），并复用共享 rubric
  if (chat.llmFilterEnabled && hasRubric) {
    return {
      mode: 'llm',
      keywordList: [],
      llmRule: rubric.sourceJd || '',
      llmConfig: { rubric, passThreshold: rubric.passThreshold }
    }
  }
  if (chat.keywordsEnabled && Array.isArray(chat.keywords)) {
    return { mode: 'keywords', keywordList: chat.keywords, llmRule: '', llmConfig: null }
  }
  // chat.regexEnabled：沟通页暂无 regex 模式（UI 已标"暂未支持"），不筛选（全部通过）
  return { mode: 'keywords', keywordList: [], llmRule: '', llmConfig: null }
}

export const getMergedJobConfig = (jobId) => {
  const recruiterConfig = readConfigFile('boss-recruiter.json') || {}
  const candidateFilterConfig = readConfigFile('candidate-filter.json') || {}

  if (!jobId) {
    return {
      ...recruiterConfig,
      candidateFilter: candidateFilterConfig
    }
  }

  const jobsConfig = readBossJobsConfig()
  const jobEntry = (jobsConfig.jobs || []).find(j => (j.jobId || j.id) === jobId)
  if (!jobEntry) {
    return {
      ...recruiterConfig,
      candidateFilter: candidateFilterConfig
    }
  }

  const jobFilter = migrateJobFilter(jobEntry.filter)
  const candidateFilter = jobFilterToCandidateFilter(jobFilter)
  // fieldRules/schoolFloorRank 现归入 per-job preFilter；优先职位自带，否则回退全局 candidate-filter.json
  candidateFilter.fieldRules = jobFilter.preFilter?.fieldRules ?? candidateFilterConfig.fieldRules
  candidateFilter.schoolFloorRank = jobFilter.preFilter?.schoolFloorRank ?? candidateFilterConfig.schoolFloorRank
  const chatPageFilter = jobFilterToChatPageFilter(jobFilter)

  // 共享 rubric 单一真源（filter.rubric）。推荐评分与沟通筛选各看自己的独立开关，不再相互强制。
  const rubric = jobFilter.rubric
  const hasRubric = Array.isArray(rubric?.dimensions) && rubric.dimensions.length > 0
  // 推荐评分：只看 recommend.scoringEnabled（且 rubric 有维度）；否则回退全局 boss-recruiter.json scoring（未选职位面板）。
  const scoring = jobFilter.recommend?.scoringEnabled && hasRubric
    ? {
        enabled: true,
        rubric: { ...rubric, passThreshold: rubric.passThreshold },
        minScoreToChat:
          typeof jobFilter.recommend.minScoreToChat === 'number'
            ? jobFilter.recommend.minScoreToChat
            : (typeof rubric.passThreshold === 'number'
                ? rubric.passThreshold
                : (recruiterConfig.scoring?.minScoreToChat ?? 0)),
        onScoreError: jobFilter.recommend.onScoreError ?? recruiterConfig.scoring?.onScoreError ?? 'skip',
        modelId: rubric.modelId ?? recruiterConfig.scoring?.modelId ?? null
      }
    : recruiterConfig.scoring

  return {
    ...recruiterConfig,
    scoring,
    candidateFilter,
    chatPage: {
      ...(recruiterConfig.chatPage || {}),
      preFilter: candidateFilter,
      filter: {
        ...(recruiterConfig.chatPage?.filter || {}),
        ...chatPageFilter
      }
    },
    _jobMeta: { jobId: jobEntry.jobId || jobEntry.id, jobName: jobEntry.jobName || jobEntry.name }
  }
}

// ── 招聘端 LLM 配置（boss-llm.json v2）─────────────────────────────────────────

const bossLlmConfigFileName = 'boss-llm.json'

const PURPOSE_KEYS = ['resume_screening', 'rubric_generation', 'greeting_generation', 'message_rewrite', 'default']
const VALID_ENDPOINT = ['auto', 'chat', 'responses']
const VALID_BRAND = ['auto', 'qwen', 'deepseek', 'glm', 'openai', 'generic']
const VALID_EFFORT = ['minimal', 'low', 'medium', 'high']

function defaultRetry () {
  return { maxAttemptsPerModel: 2, backoffMs: 500, maxBackoffMs: 20000, totalDeadlineMs: 120000 }
}

function defaultSampling () {
  return { temperature: null, max_tokens: null, top_p: null, frequency_penalty: null, presence_penalty: null }
}

function normalizeModel (m) {
  if (!m || typeof m !== 'object') return null
  const out = { ...m }
  if (typeof out.id !== 'string' || !out.id) out.id = crypto.randomUUID()
  if (typeof out.enabled !== 'boolean') out.enabled = true
  if (!VALID_BRAND.includes(out.brand)) out.brand = 'auto'
  if (!VALID_ENDPOINT.includes(out.endpoint)) out.endpoint = 'auto'
  // sampling:强制数值化。非数字(如 "0.7" 字符串、垃圾值)→ 能转就转,否则回落 null,
  // 避免把坏值原样转发给 provider 触发 400 unsupported parameter。
  const rawSampling = out.sampling && typeof out.sampling === 'object' ? out.sampling : {}
  const cleanSampling = defaultSampling()
  for (const [k, v] of Object.entries(rawSampling)) {
    if (v === null || v === undefined) {
      cleanSampling[k] = null
      continue
    }
    const n = typeof v === 'number' ? v : Number(v)
    cleanSampling[k] = Number.isFinite(n) ? n : null
  }
  out.sampling = cleanSampling
  const t = out.thinking && typeof out.thinking === 'object' ? out.thinking : {}
  // thinking 同样按已知字段非法回落:budget 限 128–32768,effort 限已知档位
  const validBudget = typeof t.budget === 'number' && t.budget >= 128 && t.budget <= 32768
  out.thinking = {
    enabled: typeof t.enabled === 'boolean' ? t.enabled : false,
    budget: validBudget ? t.budget : 2048,
    effort: VALID_EFFORT.includes(t.effort) ? t.effort : 'medium'
  }
  return out
}

/**
 * 将旧格式（flat models 数组）迁移为 providers 数组。按 baseURL 分组。
 */
function migrateFlatModelsToProviders (oldConfig) {
  const grouped = {}
  for (const m of oldConfig.models) {
    const key = m.baseURL ?? ''
    if (!grouped[key]) {
      grouped[key] = { id: crypto.randomUUID(), name: m.baseURL ?? '', baseURL: m.baseURL ?? '', apiKey: m.apiKey ?? '', models: [] }
    }
    const { baseURL: _b, apiKey: _a, ...rest } = m
    grouped[key].models.push(rest)
  }
  return { providers: Object.values(grouped), purposeDefaultModelId: oldConfig.purposeDefaultModelId ?? {} }
}

/**
 * migrateToV2(raw) — 纯函数，幂等。补全 v2 形状，非法已知字段回落默认，未知字段保留。
 */
export function migrateToV2 (raw) {
  let base = raw && typeof raw === 'object' ? { ...raw } : {}
  // flat models[] → providers
  if (Array.isArray(base.models) && !Array.isArray(base.providers)) {
    const migrated = migrateFlatModelsToProviders(base)
    base = { ...base, providers: migrated.providers, purposeDefaultModelId: migrated.purposeDefaultModelId }
    delete base.models
  }
  if (!Array.isArray(base.providers)) base.providers = []

  // providers/models 规范化
  base.providers = base.providers
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      ...p,
      id: typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID(),
      models: (Array.isArray(p.models) ? p.models : []).map(normalizeModel).filter(Boolean)
    }))

  // purposes：补全 5 键；迁移旧 purposeDefaultModelId
  const purposes = base.purposes && typeof base.purposes === 'object' ? { ...base.purposes } : {}
  const legacy = base.purposeDefaultModelId && typeof base.purposeDefaultModelId === 'object' ? base.purposeDefaultModelId : {}
  for (const k of PURPOSE_KEYS) {
    const existing = purposes[k]
    if (existing && Array.isArray(existing.modelIds)) continue
    if (legacy[k]) purposes[k] = { modelIds: [legacy[k]] }
    else purposes[k] = { modelIds: [] }
  }
  base.purposes = purposes
  delete base.purposeDefaultModelId

  // retry：补全 + 非法值回落
  const r = base.retry && typeof base.retry === 'object' ? base.retry : {}
  const d = defaultRetry()
  base.retry = {
    maxAttemptsPerModel: Number.isInteger(r.maxAttemptsPerModel) && r.maxAttemptsPerModel >= 0 ? r.maxAttemptsPerModel : d.maxAttemptsPerModel,
    backoffMs: typeof r.backoffMs === 'number' && r.backoffMs >= 0 ? r.backoffMs : d.backoffMs,
    maxBackoffMs: typeof r.maxBackoffMs === 'number' && r.maxBackoffMs >= 0 ? r.maxBackoffMs : d.maxBackoffMs,
    totalDeadlineMs: typeof r.totalDeadlineMs === 'number' && r.totalDeadlineMs >= 0 ? r.totalDeadlineMs : d.totalDeadlineMs
  }

  base.version = 2
  return base
}

const defaultBossLlmConfig = () => migrateToV2({})

function atomicWrite (filePath, content) {
  const tmp = filePath + '.tmp'
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, filePath)
}

export const readBossLlmConfig = () => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossLlmConfigFileName)
  if (!fs.existsSync(filePath)) return defaultBossLlmConfig()

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    // 坏 JSON：备份后回落默认
    try { fs.copyFileSync(filePath, filePath + '.bak') } catch { /* ignore */ }
    const def = defaultBossLlmConfig()
    try { atomicWrite(filePath, JSON.stringify(def)) } catch { /* ignore */ }
    return def
  }

  const migrated = migrateToV2(raw)
  // 若迁移产生变化，写前备份 + 原子写
  try {
    const before = JSON.stringify(raw)
    const after = JSON.stringify(migrated)
    if (before !== after) {
      try { fs.copyFileSync(filePath, filePath + '.bak') } catch { /* ignore */ }
      atomicWrite(filePath, after)
    }
  } catch { /* 写回失败不影响本次使用 */ }
  return migrated
}

export const writeBossLlmConfig = async (config) => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossLlmConfigFileName)
  const normalized = migrateToV2(config)
  atomicWrite(filePath, JSON.stringify(normalized))
}

