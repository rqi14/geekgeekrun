import { ACCOUNT_BANNED_TEXT_REGEXP, QUOTA_BLOCKED_TEXT_REGEXP } from '../../constant.mjs'

export const STATES = {
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  VERIFY: 'VERIFY',
  RESUME_MODAL: 'RESUME_MODAL',
  LIST_REASON_PANEL: 'LIST_REASON_PANEL',
  RESUME_REJECT_DIALOG: 'RESUME_REJECT_DIALOG',
  GOVERNANCE_NOTICE: 'GOVERNANCE_NOTICE',
  QUOTA_BLOCKED: 'QUOTA_BLOCKED',
  LIST: 'LIST',
  UNKNOWN: 'UNKNOWN'
}

const has = (classes, needle) => classes.some((c) => c.includes(needle))

/**
 * 纯状态判定。signals 由 gatherSignals 从主页面+recommendFrame 抽取。
 * 优先级：封禁 > 验证 > 简历弹窗 > 列表原因面板 > 简历拒绝弹窗 > 治理公告 > 额度 > 列表 > 未知。
 * @param {{mainText:string, mainOverlayClasses:string[], frameOverlayClasses:string[], frameHasList:boolean, verify:boolean}} s
 */
export function classifyState (s) {
  if (ACCOUNT_BANNED_TEXT_REGEXP.test(s.mainText || '')) return STATES.ACCOUNT_BANNED
  if (s.verify) return STATES.VERIFY
  if (has(s.frameOverlayClasses, 'dialog-lib-resume')) return STATES.RESUME_MODAL
  if (has(s.frameOverlayClasses, 'card-reason-f1')) return STATES.LIST_REASON_PANEL
  if (has(s.mainOverlayClasses, 'dialog-wrap') && /选择原因/.test(s.mainText || '')) return STATES.RESUME_REJECT_DIALOG
  if (has(s.mainOverlayClasses, 'dialog-uninstall-extension')) return STATES.GOVERNANCE_NOTICE
  if (QUOTA_BLOCKED_TEXT_REGEXP.test(s.mainText || '')) return STATES.QUOTA_BLOCKED
  if (s.frameHasList) return STATES.LIST
  return STATES.UNKNOWN
}
