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

export const readBossJobsConfig = () => {
  ensureRuntimeFolderPathExist()
  const filePath = path.join(configFolderPath, bossJobsConfigFileName)
  if (!fs.existsSync(filePath)) {
    return { jobs: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return { jobs: [] }
  }
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
  const f = jobFilter
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
    skipViewedCandidates: f.skipViewedCandidates === true
  }
}

// 测试别名（供 recommend/pure/job-filter-passthrough.test.mjs 使用）
export const __jobFilterToCandidateFilter = jobFilterToCandidateFilter

/**
 * 将 boss-jobs-config 的 filter 转换为 chatPage.filter 格式（简历筛选）。
 * 优先级：resumeLlmEnabled（rubric）> resumeLlmEnabled（rule）> resumeKeywordsEnabled > resumeRegExpEnabled
 */
function jobFilterToChatPageFilter (jobFilter) {
  if (!jobFilter || typeof jobFilter !== 'object') {
    return { mode: 'keywords', keywordList: [], llmRule: '', llmConfig: null }
  }
  const f = jobFilter
  // resumeLlmConfig（Rubric 模式）优先
  if (f.resumeLlmEnabled && f.resumeLlmConfig?.rubric) {
    return {
      mode: 'llm',
      keywordList: [],
      llmRule: f.resumeLlmConfig.sourceJd || '',
      llmConfig: f.resumeLlmConfig
    }
  }
  if (f.resumeLlmEnabled && typeof f.resumeLlmRule === 'string') {
    return { mode: 'llm', keywordList: [], llmRule: f.resumeLlmRule, llmConfig: null }
  }
  if (f.resumeKeywordsEnabled && Array.isArray(f.resumeKeywords)) {
    return { mode: 'keywords', keywordList: f.resumeKeywords, llmRule: '', llmConfig: null }
  }
  // resumeRegExpEnabled：chat-page 暂无 regex 模式，暂不筛选（全部通过），后续可扩展
  if (f.resumeRegExpEnabled && typeof f.resumeRegExpStr === 'string' && f.resumeRegExpStr) {
    return { mode: 'keywords', keywordList: [], llmRule: '', llmConfig: null }
  }
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

  const jobFilter = jobEntry.filter
  const candidateFilter = jobFilterToCandidateFilter(jobFilter)
  const chatPageFilter = jobFilterToChatPageFilter(jobFilter)

  return {
    ...recruiterConfig,
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
  out.sampling = { ...defaultSampling(), ...(out.sampling && typeof out.sampling === 'object' ? out.sampling : {}) }
  const t = out.thinking && typeof out.thinking === 'object' ? out.thinking : {}
  out.thinking = {
    enabled: typeof t.enabled === 'boolean' ? t.enabled : false,
    budget: typeof t.budget === 'number' ? t.budget : 2048,
    effort: typeof t.effort === 'string' ? t.effort : 'medium'
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
    maxAttemptsPerModel: Number.isInteger(r.maxAttemptsPerModel) && r.maxAttemptsPerModel >= 1 ? r.maxAttemptsPerModel : d.maxAttemptsPerModel,
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

