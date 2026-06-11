const DEGREE_RE = /本科|硕士|博士|大专|专科|MBA|中专|高中|初中/

/**
 * 归一化 list-scraper 抽出的 raw 卡片为筛选/评分用的候选对象。纯函数。
 */
export function mapRawCard (raw) {
  const baseInfo = Array.isArray(raw.baseInfo) ? raw.baseInfo : []
  const expect = Array.isArray(raw.expect) ? raw.expect : []
  return {
    encryptGeekId: raw.encryptGeekId ?? '',
    geekName: raw.name ?? '',
    salary: raw.salary ?? null,
    activeText: raw.activeText ?? '',
    age: baseInfo.find((s) => /岁/.test(s)) ?? null,
    workExp: baseInfo.find((s) => (/年|经验不限/.test(s)) && !/应届/.test(s)) ?? null,
    education: baseInfo.find((s) => DEGREE_RE.test(s)) ?? null,
    city: expect[0] ?? null,
    jobTitle: expect[1] ?? null,
    skills: raw.advantage ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    inViewport: !!raw.inViewport,
    interactable: !!raw.interactable
  }
}

/** 是否主候选卡（排除相似推荐/促销、无 id 的） */
export function isPrimaryCard (raw) {
  if (!raw) return false
  if (raw.isSimilar) return false
  if (!raw.encryptGeekId) return false
  return true
}
