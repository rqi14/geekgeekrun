import { NOT_INTERESTED_FUZZY_RULES } from '../../constant.mjs'

/**
 * 在动态生成的原因选项里，按 internalReason 的子串规则选最贴切的一项。
 * @param {string} internalReason - city|education|workExp|skills|viewed|blockName|...
 * @param {string[]} optionTexts - 弹窗里实际出现的选项文案
 * @param {string} fallback - 都不命中时返回（通常"其他原因"）
 * @returns {string} 选中的选项文案；若 optionTexts 里没有 fallback，则返回第一个选项兜底
 */
export function fuzzyReason (internalReason, optionTexts, fallback) {
  const substrs = NOT_INTERESTED_FUZZY_RULES[internalReason] || []
  for (const needle of substrs) {
    const hit = optionTexts.find((t) => t.includes(needle))
    if (hit) return hit
  }
  const fb = optionTexts.find((t) => t.includes(fallback))
  if (fb) return fb
  return fallback
}
