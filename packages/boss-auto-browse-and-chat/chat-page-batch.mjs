export function classifyConversationBatch (conversations, seenIds, batchSize) {
  const visibleItems = (Array.isArray(conversations) ? conversations : [])
    .filter((item) => item?.encryptGeekId)
  const unseenItems = visibleItems.filter((item) => !seenIds.has(item.encryptGeekId))
  const safeBatchSize = Math.max(0, Number.isFinite(batchSize) ? Math.floor(batchSize) : 0)

  return {
    batch: unseenItems.slice(0, safeBatchSize),
    unreadExhausted: visibleItems.length === 0,
    onlySeenVisible: visibleItems.length > 0 && unseenItems.length === 0,
    visibleCount: visibleItems.length,
    unseenCount: unseenItems.length
  }
}
