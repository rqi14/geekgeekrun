export function buildRecommendWorkerRunMode(config: {
  recommendPage?: {
    keepBrowserOpenAfterRun?: boolean
  }
} = {}) {
  const keepBrowserOpenAfterRun = config.recommendPage?.keepBrowserOpenAfterRun === true
  return {
    keepBrowserOpenAfterRun,
    returnBrowser: keepBrowserOpenAfterRun,
    shouldRerunAfterComplete: false
  }
}
