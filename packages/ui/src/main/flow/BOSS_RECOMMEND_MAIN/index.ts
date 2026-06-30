import { app, dialog } from 'electron'
import { AsyncSeriesHook, AsyncSeriesWaterfallHook } from 'tapable'
import { AUTO_CHAT_ERROR_EXIT_CODE } from '../../../common/enums/auto-start-chat'
import attachListenerForKillSelfOnParentExited from '../../utils/attachListenerForKillSelfOnParentExited'
import minimist from 'minimist'
import SqlitePluginModule from '@geekgeekrun/sqlite-plugin'
import { connectToDaemon, sendToDaemon } from '../OPEN_SETTING_WINDOW/connect-to-daemon'
import { checkShouldExit } from '../../utils/worker'
import initPublicIpc from '../../utils/initPublicIpc'
import { forwardConsoleLogToDaemon } from '../../utils/forwardConsoleLogToDaemon'
import { getLastUsedAndAvailableBrowser } from '../DOWNLOAD_DEPENDENCIES/utils/browser-history'
import path from 'path'
import { buildRecommendWorkerRunMode } from './run-mode'
const { default: SqlitePlugin } = SqlitePluginModule

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出')
  process.exit(0)
})

const initPlugins = async (hooks) => {
  const { storageFilePath } = await import(
    '@geekgeekrun/boss-auto-browse-and-chat/runtime-file-utils.mjs'
  )
  new SqlitePlugin(path.join(storageFilePath, 'public.db')).apply(hooks)
}

const argv = minimist(process.argv.slice(2))
const runRecordId = argv['run-record-id'] ?? null
const jobId: string | null = argv['job-id'] ?? null

const log = (msg: string) => {
  console.log(`[boss-recommend-worker] ${msg}`)
}

const runRecommend = async () => {
  app.dock?.hide()
  log('runRecommend 开始')
  log(`正在查找可用浏览器...`)
  let puppeteerExecutable = await getLastUsedAndAvailableBrowser()
  if (!puppeteerExecutable) {
    log('未找到可用浏览器，退出')
    await dialog.showMessageBox({
      type: `error`,
      message: `未找到可用的浏览器`,
      detail: `请重新运行本程序，按照提示安装、配置浏览器`
    })
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'puppeteer-executable-check',
          status: 'rejected'
        },
        runRecordId
      }
    })
    app.exit(AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE)
    return
  }
  log(`找到浏览器: ${puppeteerExecutable.executablePath}`)
  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: {
        id: 'puppeteer-executable-check',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  process.env.PUPPETEER_EXECUTABLE_PATH = puppeteerExecutable.executablePath

  log('正在动态 import boss package...')
  type BossAutoBrowseModule = {
    default: (hooks: any, opts?: { returnBrowser?: boolean }) => Promise<void | { browser: any; page: any }>
    initPuppeteer: () => Promise<any>
    bossAutoBrowseEventBus: InstanceType<typeof import('node:events').EventEmitter>
  }
  const {
    default: startBossAutoBrowse,
    initPuppeteer,
    bossAutoBrowseEventBus
  } = (await import('@geekgeekrun/boss-auto-browse-and-chat/index.mjs')) as unknown as BossAutoBrowseModule
  log('boss package import 完成，初始化 puppeteer...')

  process.on('disconnect', () => {
    app.exit()
  })

  await initPuppeteer()
  log('puppeteer 初始化完成，初始化 hooks 和插件...')

  const hooks = {
    beforeBrowserLaunch: new AsyncSeriesHook(['_']),
    afterBrowserLaunch: new AsyncSeriesHook(['_']),
    beforeNavigateToRecommend: new AsyncSeriesHook(['_']),
    onCandidateListLoaded: new AsyncSeriesHook(['_']),
    onCandidateFiltered: new AsyncSeriesWaterfallHook(['candidates', 'filterResult'] as any),
    beforeStartChat: new AsyncSeriesHook(['candidate']),
    afterChatStarted: new AsyncSeriesHook(['candidate', 'result'] as any),
    onError: new AsyncSeriesHook(['error']),
    onComplete: new AsyncSeriesHook(['_']),
    onProgress: new AsyncSeriesHook(['payload'] as any),
    onScoreError: new AsyncSeriesHook(['payload'] as any)
  }

  await initPlugins(hooks)
  log('插件初始化完成，即将启动浏览器...')

  hooks.beforeBrowserLaunch.tapPromise('log', async () => { log('beforeBrowserLaunch') })
  hooks.afterBrowserLaunch.tapPromise('log', async () => { log('afterBrowserLaunch - 浏览器已启动') })
  hooks.beforeNavigateToRecommend.tapPromise('log', async () => { log('beforeNavigateToRecommend - 正在导航到推荐页') })

  bossAutoBrowseEventBus.once('LOGIN_STATUS_INVALID', () => {})

  hooks.onCandidateListLoaded.tap('sendLoginStatusCheck', () => {
    log('onCandidateListLoaded - 登录成功，候选人列表已加载')
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'prerequisite-step-by-step-checkstep-by-step-check',
        step: {
          id: 'login-status-check',
          status: 'fulfilled'
        },
        runRecordId
      }
    })
  })

  hooks.onProgress.tap('sendProgressToGui', (payload: unknown) => {
    const p = payload as { phase?: string; current?: number; max?: number }
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'boss-auto-browse-progress',
        workerId: 'bossRecommendMain',
        runRecordId,
        phase: p?.phase,
        current: p?.current ?? 0,
        max: p?.max ?? 0
      }
    })
  })

  hooks.onScoreError.tapPromise('sendScoreErrorToGui', async (payload: unknown) => {
    const p = payload as { failedCount?: number; total?: number; names?: string[] }
    const failedCount = p?.failedCount ?? 0
    const names = Array.isArray(p?.names) ? p.names : []
    const nameHint = names.length ? `（${names.slice(0, 5).join('、')}${names.length > 5 ? '…' : ''}）` : ''
    log(`onScoreError - 本轮 ${failedCount} 人评分失败${nameHint}`)
    sendToDaemon({
      type: 'worker-to-gui-message',
      data: {
        type: 'boss-auto-browse-notice',
        level: 'warning',
        workerId: 'bossRecommendMain',
        runRecordId,
        message: `本轮 ${failedCount} 人简历评分失败（限流/网络），已按 0 分跳过、不会误打招呼${nameHint}`
      }
    })
  })

  try {
    const { readConfigFile } = await import(
      '@geekgeekrun/boss-auto-browse-and-chat/runtime-file-utils.mjs'
    )
    const cfg = readConfigFile('boss-recruiter.json') as {
      recommendPage?: {
        keepBrowserOpenAfterRun?: boolean
      }
    }
    const { keepBrowserOpenAfterRun, returnBrowser } = buildRecommendWorkerRunMode(cfg)

    if (jobId) {
      const { getMergedJobConfig } = await import(
        '@geekgeekrun/boss-auto-browse-and-chat/runtime-file-utils.mjs'
      )
      const mergedCfg = getMergedJobConfig(jobId)
      log(`使用 job-id=${jobId} 的合并配置`)
      Object.assign(cfg, mergedCfg)
    }

    log('开始执行 startBossAutoBrowse（推荐页）...')
    const result = await startBossAutoBrowse(hooks, { returnBrowser, jobId: jobId ?? undefined } as any)
    if (result && typeof result === 'object' && 'browser' in result && result.browser) {
      const browser = result.browser
      if (keepBrowserOpenAfterRun) {
        log('运行已结束，浏览器保持打开，请手动关闭浏览器窗口后将自动退出')
        await new Promise<void>((resolve) => {
          browser.once('disconnected', () => resolve())
        })
        process.exit(0)
      }
      try {
        await browser.close()
      } catch (e) {
        void e
      }
    }
    log('startBossAutoBrowse 完成，推荐牛人单次运行结束')
    process.exit(0)
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('LOGIN_STATUS_INVALID')) {
        await dialog.showMessageBox({
          type: `error`,
          message: `登录状态无效`,
          detail: `请重新登录BOSS直聘（招聘端）`
        })
        process.exit(AUTO_CHAT_ERROR_EXIT_CODE.LOGIN_STATUS_INVALID)
      }
      if (err.message.includes('ERR_INTERNET_DISCONNECTED')) {
        process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ERR_INTERNET_DISCONNECTED)
      }
      if (err.message.includes('ACCESS_IS_DENIED')) {
        process.exit(AUTO_CHAT_ERROR_EXIT_CODE.ACCESS_IS_DENIED)
      }
      if (
        err.message.includes(`Could not find Chrome`) ||
        err.message.includes(`no executable was found`)
      ) {
        process.exit(AUTO_CHAT_ERROR_EXIT_CODE.PUPPETEER_IS_NOT_EXECUTABLE)
      }
    }
    console.error('[Boss Recommend Main] error:', err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : JSON.stringify(err))
    const shouldExit = await checkShouldExit()
    if (shouldExit) {
      app.exit()
      return
    }
    console.log(
      '[Boss Recommend Main] An internal error is caught; recommend worker is single-run and will exit.'
    )
    process.exit(1)
  }
}

export const waitForProcessHandShakeAndRunAutoChat = async () => {
  await app.whenReady()
  app.on('window-all-closed', () => {
    // keep process alive while worker is running
  })
  initPublicIpc()
  await connectToDaemon()
  forwardConsoleLogToDaemon('bossRecommendMain', runRecordId)
  await sendToDaemon(
    {
      type: 'ping'
    },
    {
      needCallback: true
    }
  )
  sendToDaemon({
    type: 'worker-to-gui-message',
    data: {
      type: 'prerequisite-step-by-step-checkstep-by-step-check',
      step: {
        id: 'worker-launch',
        status: 'fulfilled'
      },
      runRecordId
    }
  })
  runRecommend()
}

attachListenerForKillSelfOnParentExited()
