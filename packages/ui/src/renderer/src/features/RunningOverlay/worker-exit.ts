const NORMAL_EXIT_CODE = 0
const NORMAL_EXITED_STATUS = 1
const ERROR_EXITED_STATUS = 2

export function getRunningOverlayExitAction(code?: number) {
  const isNormalExit = code === NORMAL_EXIT_CODE

  return {
    status: isNormalExit ? NORMAL_EXITED_STATUS : ERROR_EXITED_STATUS,
    analyticsEvent: isNormalExit ? 'running_overlay_normal_exited' : 'running_overlay_error_exited',
    shouldHide: isNormalExit
  }
}
