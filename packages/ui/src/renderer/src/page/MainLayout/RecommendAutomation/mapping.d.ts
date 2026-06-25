// 类型声明：配合 mapping.mjs（纯 JS）供 .vue/.ts 使用。

export interface ScoringState {
  enabled: boolean
  jd: string
  minScoreToChat: number
  onScoreError: 'skip' | 'greetIfRulePass'
  modelId: string | null
}

export interface FilterState {
  expectCityList: string[]
  expectEducationRegExpStr: string
  expectWorkExpRange: [number, number]
  expectSalaryRange: [number, number]
  expectSalaryWhenNegotiable: 'exclude' | 'include'
  expectSkillKeywords: string[]
  expectSchoolKeywords: string[]
  expectMajorKeywords: string[]
  blockCandidateNameRegExpStr: string
  skipViewedCandidates: boolean
}

export interface BudgetState {
  waveSize: number
  maxGreetPerRun: number
  maxXPerRun: number
  maxScrollSteps: number
  maxStaleWaves: number
  scrollDelayMsRange: [number, number]
  delayBetweenActionsMs: [number, number]
}

export interface RunState {
  clickNotInterestedForFiltered: boolean
  runOnceAfterComplete: boolean
  rerunIntervalMs: number
  keepBrowserOpenAfterRun: boolean
  persistProfile: boolean
}

export interface RecommendConfigState {
  scoring: ScoringState
  filter: FilterState
  budget: BudgetState
  run: RunState
}

export interface RawConfigInput {
  'boss-recruiter.json'?: Record<string, unknown>
  'candidate-filter.json'?: Record<string, unknown>
}

export const DEFAULTS: {
  waveSize: number
  maxGreetPerRun: number
  maxXPerRun: number
  maxScrollSteps: number
  maxStaleWaves: number
  scrollDelayMsRange: [number, number]
  delayBetweenActionsMs: [number, number]
  minScoreToChat: number
  onScoreError: 'skip' | 'greetIfRulePass'
  rerunIntervalMs: number
}

export function normalizeRecommendConfig(raw: RawConfigInput): RecommendConfigState
export function toSavePayload(s: RecommendConfigState): Record<string, unknown>
