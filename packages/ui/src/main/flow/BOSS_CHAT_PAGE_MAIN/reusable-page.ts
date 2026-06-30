export type ChatPageRefreshAction = 'reload' | 'goto'

type ReusableChatPage = {
  url: () => string
  reload: (options?: { timeout?: number; waitUntil?: string }) => Promise<unknown>
  goto: (url: string, options?: { timeout?: number }) => Promise<unknown>
  waitForFunction: (pageFunction: () => boolean, options?: { timeout?: number }) => Promise<unknown>
}

const CHAT_ROUTE_FRAGMENT = '/web/chat/'

export const chooseChatPageRefreshAction = (
  currentUrl: string,
  chatPageUrl: string
): ChatPageRefreshAction => {
  return currentUrl.startsWith(chatPageUrl) || currentUrl.includes(CHAT_ROUTE_FRAGMENT)
    ? 'reload'
    : 'goto'
}

export const refreshChatPageForNextRound = async (
  page: ReusableChatPage,
  chatPageUrl: string
): Promise<ChatPageRefreshAction> => {
  let currentUrl = ''
  try {
    currentUrl = page.url()
  } catch {
    currentUrl = ''
  }

  const action = chooseChatPageRefreshAction(currentUrl, chatPageUrl)
  if (action === 'reload') {
    await page.reload({ timeout: 60 * 1000, waitUntil: 'domcontentloaded' })
  } else {
    await page.goto(chatPageUrl, { timeout: 60 * 1000 })
  }

  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 120 * 1000 })
  return action
}
