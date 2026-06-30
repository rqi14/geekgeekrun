export interface BossChatPageState {
  chatPage: {
    maxProcessPerRun: number
    runOnceAfterComplete: boolean
    keepBrowserOpenAfterRun: boolean
    rerunIntervalMs: number
    attachmentResume: {
      skipDownload: boolean
    }
  }
}

export const DEFAULTS = {
  maxProcessPerRun: 20,
  runOnceAfterComplete: false,
  keepBrowserOpenAfterRun: false,
  rerunIntervalMs: 3000,
  attachmentResumeSkipDownload: false
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && !Number.isNaN(value) ? value : fallback

const objectOrEmpty = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

export const normalizeBossChatPageConfig = (raw: unknown): BossChatPageState => {
  const recruiterConfig = objectOrEmpty(objectOrEmpty(raw)['boss-recruiter.json'])
  const chatPage = objectOrEmpty(recruiterConfig.chatPage)
  const attachmentResume = objectOrEmpty(chatPage.attachmentResume)

  return {
    chatPage: {
      maxProcessPerRun: num(chatPage.maxProcessPerRun, DEFAULTS.maxProcessPerRun),
      runOnceAfterComplete: chatPage.runOnceAfterComplete === true,
      keepBrowserOpenAfterRun: chatPage.keepBrowserOpenAfterRun === true,
      rerunIntervalMs: num(chatPage.rerunIntervalMs, DEFAULTS.rerunIntervalMs),
      attachmentResume: {
        skipDownload:
          attachmentResume.skipDownload === true ||
          DEFAULTS.attachmentResumeSkipDownload
      }
    }
  }
}

export const toSavePayload = (state: BossChatPageState) => ({
  chatPage: {
    maxProcessPerRun: state.chatPage.maxProcessPerRun,
    runOnceAfterComplete: state.chatPage.runOnceAfterComplete,
    keepBrowserOpenAfterRun: state.chatPage.keepBrowserOpenAfterRun,
    rerunIntervalMs: state.chatPage.rerunIntervalMs,
    attachmentResume: {
      skipDownload: state.chatPage.attachmentResume.skipDownload
    }
  }
})
