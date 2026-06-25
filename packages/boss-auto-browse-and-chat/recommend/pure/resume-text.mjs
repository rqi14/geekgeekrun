/**
 * 丢弃 canvas 抓取里 WASM 字体预热产生的噪声行：定位首个含"活跃"的行，之前的全丢；
 * 兜底丢弃不含汉字的行。（原 chat-page-processor 私有函数，提取为共享纯函数。）
 * @param {string[]} lines - extractResumeText 返回的行数组
 * @returns {string[]} 去除预热数据后的行数组
 */
export function filterFontTestLines (lines) {
  const idx = lines.findIndex((line) => line.includes('活跃'))
  if (idx > 0) return lines.slice(idx)
  return lines.filter((line) => /[一-鿿]/.test(line))
}
