// 类型声明：配合 mapping.mjs（纯 JS）供 .vue/.ts 使用。

export interface BudgetState {
  waveSize: number
  maxGreetPerRun: number
  maxViewPerRun: number
  maxXPerRun: number
  maxScrollSteps: number
  maxStaleWaves: number
  scoreConcurrency: number
  scoreMaxAttempts: number
  scrollDelayMsRange: [number, number]
  delayBetweenActionsMs: [number, number]
}

export interface RunState {
  clickNotInterestedForFiltered: boolean
  runOnceAfterComplete: boolean
  rerunIntervalMs: number
  keepBrowserOpenAfterRun: boolean
}

export interface RecommendConfigState {
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
  maxViewPerRun: number
  maxXPerRun: number
  maxScrollSteps: number
  maxStaleWaves: number
  scoreConcurrency: number
  scoreMaxAttempts: number
  scrollDelayMsRange: [number, number]
  delayBetweenActionsMs: [number, number]
  rerunIntervalMs: number
}

export function normalizeRecommendConfig(raw: RawConfigInput): RecommendConfigState
export function toSavePayload(s: RecommendConfigState): Record<string, unknown>
