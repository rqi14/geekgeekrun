export const MANUAL_VERIFICATION_ALERT_TITLE = 'GeekGeekRun - 需要人工验证'
export const MANUAL_VERIFICATION_ALERT_BODY =
  '检测到 BOSS 直聘安全验证，请在打开的浏览器窗口中完成验证，完成后程序将自动继续。'
export const MANUAL_VERIFICATION_ALERT_DIALOG_MESSAGE = '需要人工验证'
export const MANUAL_VERIFICATION_ALERT_DIALOG_DETAIL =
  '检测到 BOSS 直聘安全验证。\n\n请切换到软件打开的浏览器窗口，手动完成验证。完成后程序会自动继续。'
export const DEFAULT_MANUAL_VERIFICATION_ALERT_COOLDOWN_MS = 60_000
export const DEFAULT_WINDOWS_APP_USER_MODEL_ID = 'com.geekgeekrun.ui'

const defaultAlertState = new Map()
let appUserModelIdConfigured = false

function logAlertIssue(logger, message) {
  if (typeof logger === 'function') {
    logger(message)
  }
}

export function markManualVerificationAlertShown(options = {}) {
  const {
    key = 'boss-manual-verification',
    state = defaultAlertState,
    now = () => Date.now(),
    cooldownMs = DEFAULT_MANUAL_VERIFICATION_ALERT_COOLDOWN_MS
  } = options

  const nowMs = now()
  const lastShownAt = state.get(key)
  if (typeof lastShownAt === 'number' && nowMs - lastShownAt < cooldownMs) {
    return false
  }

  state.set(key, nowMs)
  return true
}

async function loadElectron(electron, logger) {
  if (electron) return electron
  try {
    return await import('electron')
  } catch (error) {
    logAlertIssue(logger, `[manual-verification-alert] electron 不可用：${error?.message ?? String(error)}`)
    return null
  }
}

function configureWindowsAppUserModelId(electron, appUserModelId, logger) {
  if (appUserModelIdConfigured) return
  const setAppUserModelId = electron?.app?.setAppUserModelId
  if (typeof setAppUserModelId !== 'function') return

  try {
    setAppUserModelId.call(electron.app, appUserModelId)
    appUserModelIdConfigured = true
  } catch (error) {
    logAlertIssue(
      logger,
      `[manual-verification-alert] 设置 Windows AppUserModelID 失败：${error?.message ?? String(error)}`
    )
  }
}

async function showNotification(electron, title, body, logger) {
  const Notification = electron?.Notification
  if (!Notification) return false
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) {
    return false
  }

  try {
    new Notification({ title, body }).show()
    return true
  } catch (error) {
    logAlertIssue(logger, `[manual-verification-alert] 系统通知失败：${error?.message ?? String(error)}`)
    return false
  }
}

async function showDialog(electron, options, logger) {
  const showMessageBox = electron?.dialog?.showMessageBox
  if (typeof showMessageBox !== 'function') return false

  const {
    title,
    message,
    detail,
    parentWindow
  } = options
  const dialogOptions = {
    type: 'warning',
    title,
    message,
    detail,
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true,
    normalizeAccessKeys: true
  }

  try {
    if (parentWindow) {
      await showMessageBox.call(electron.dialog, parentWindow, dialogOptions)
    } else {
      await showMessageBox.call(electron.dialog, dialogOptions)
    }
    return true
  } catch (error) {
    logAlertIssue(logger, `[manual-verification-alert] 原生弹窗失败：${error?.message ?? String(error)}`)
    return false
  }
}

export async function showManualVerificationAlert(options = {}) {
  const {
    key = 'boss-manual-verification',
    state = defaultAlertState,
    now = () => Date.now(),
    cooldownMs = DEFAULT_MANUAL_VERIFICATION_ALERT_COOLDOWN_MS,
    electron,
    logger,
    title = MANUAL_VERIFICATION_ALERT_TITLE,
    body = MANUAL_VERIFICATION_ALERT_BODY,
    message = MANUAL_VERIFICATION_ALERT_DIALOG_MESSAGE,
    detail = MANUAL_VERIFICATION_ALERT_DIALOG_DETAIL,
    parentWindow,
    appUserModelId = DEFAULT_WINDOWS_APP_USER_MODEL_ID,
    showNativeDialog = true
  } = options

  if (!markManualVerificationAlertShown({ key, state, now, cooldownMs })) {
    return {
      shown: false,
      notificationShown: false,
      dialogShown: false,
      skippedReason: 'throttled'
    }
  }

  const electronApi = await loadElectron(electron, logger)
  if (!electronApi) {
    return {
      shown: true,
      notificationShown: false,
      dialogShown: false,
      skippedReason: null
    }
  }

  configureWindowsAppUserModelId(electronApi, appUserModelId, logger)

  const notificationShown = await showNotification(electronApi, title, body, logger)
  const dialogShown = showNativeDialog
    ? await showDialog(electronApi, { title, message, detail, parentWindow }, logger)
    : false

  return {
    shown: true,
    notificationShown,
    dialogShown,
    skippedReason: null
  }
}
