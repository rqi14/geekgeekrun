const NORMAL_EXIT_CODE = 0

type ChatPageRoundSummaryLike = {
  unreadExhausted: boolean
  reachedMaxProcessPerRun: boolean
}

type BrowserLike = {
  close?: () => Promise<void> | void
  once?: (eventName: 'disconnected', listener: () => void) => void
}

export async function stopChatWorkerAfterRoundIfNeeded({
  runOnceAfterComplete,
  round,
  keepBrowserOpenAfterRun,
  browser,
  log,
  exit
}: {
  runOnceAfterComplete: boolean
  round: ChatPageRoundSummaryLike
  keepBrowserOpenAfterRun: boolean
  browser: BrowserLike | null
  log: (message: string) => void
  exit: (code: number) => void
}): Promise<boolean> {
  if (!runOnceAfterComplete && (!round.unreadExhausted || round.reachedMaxProcessPerRun)) {
    return false
  }

  if (keepBrowserOpenAfterRun) {
    log('运行已结束，浏览器保持打开，请手动关闭浏览器窗口后将自动退出')
    if (browser?.once) {
      await new Promise<void>((resolve) => {
        browser.once?.('disconnected', () => resolve())
      })
    }
  } else if (browser?.close) {
    try {
      await browser.close()
    } catch (e) {
      void e
    }
  }

  log(runOnceAfterComplete ? '已配置 runOnceAfterComplete，本次运行后停止' : '未读列表已清空，沟通任务自动结束')
  exit(NORMAL_EXIT_CODE)
  return true
}
