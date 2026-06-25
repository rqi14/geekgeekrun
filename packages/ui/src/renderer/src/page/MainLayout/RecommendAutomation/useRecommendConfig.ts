import { reactive } from 'vue'
import { normalizeRecommendConfig, toSavePayload } from './mapping'
import type { RecommendConfigState } from './mapping'

const { ipcRenderer } = electron

interface ModelOption {
  id: string
  label: string
}

export async function loadRecommendConfig(): Promise<{
  state: RecommendConfigState
  sequenceJobsEnabled: boolean
}> {
  const result = await ipcRenderer.invoke('fetch-boss-recruiter-config-file-content')
  const raw = result?.config ?? {}

  let sequenceJobsEnabled = false
  try {
    const jobsConfig = await ipcRenderer.invoke('fetch-boss-jobs-config')
    const jobs = jobsConfig?.jobs ?? []
    sequenceJobsEnabled = Array.isArray(jobs)
      ? jobs.some((j: { sequence?: { enabled?: boolean } }) => j?.sequence?.enabled === true)
      : false
  } catch (err) {
    console.error('[useRecommendConfig] 读取 boss-jobs-config 失败', err)
  }

  const state = reactive(normalizeRecommendConfig(raw)) as RecommendConfigState
  return { state, sequenceJobsEnabled }
}

export async function saveRecommendConfig(state: RecommendConfigState): Promise<void> {
  await ipcRenderer.invoke('save-boss-recruiter-config', JSON.stringify(toSavePayload(state)))
}

export async function fetchEnabledModels(): Promise<ModelOption[]> {
  const config = await ipcRenderer.invoke('boss-fetch-llm-config')
  const providers = config?.providers ?? []
  const out: ModelOption[] = []
  for (const provider of providers) {
    const models = provider?.models ?? []
    for (const model of models) {
      if (model?.enabled === false) continue
      if (typeof model?.id !== 'string' || !model.id) continue
      out.push({
        id: model.id,
        label: `${provider?.name ?? '未命名'} / ${model?.name || model?.model || model.id}`
      })
    }
  }
  return out
}
