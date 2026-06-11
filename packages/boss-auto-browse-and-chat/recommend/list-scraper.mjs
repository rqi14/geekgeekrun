import { mapRawCard, isPrimaryCard } from './pure/card-mapper.mjs'

/** 自包含：在 recommendFrame 内抽取每个 li.card-item 的 raw 字段 + 几何/可达性 */
function extractRawCardsInFrame () {
  const vh = (document.scrollingElement || document.documentElement).clientHeight
  const lis = Array.from(document.querySelectorAll('ul.card-list > li.card-item'))
  const txt = (el, sel) => {
    const n = el.querySelector(sel)
    return n ? n.textContent.trim() : ''
  }
  const txts = (el, sel) =>
    Array.from(el.querySelectorAll(sel))
      .map((n) => n.textContent.trim())
      .filter(Boolean)
  return lis.map((li) => {
    const isSimilar = !!li.querySelector('div.similar-geek-wrap')
    const inner = li.querySelector('div.candidate-card-wrap > div.card-inner[data-geek]')
    const r = (inner || li).getBoundingClientRect()
    const inViewport = r.top >= 0 && r.bottom <= vh
    const interactable = r.bottom > 8 && r.top < vh - 8 && r.height > 20
    return {
      encryptGeekId: inner
        ? inner.getAttribute('data-geek') || inner.getAttribute('data-geekid') || ''
        : '',
      isSimilar,
      name: inner ? txt(inner, 'span.name') : '',
      salary: inner ? txt(inner, 'div.salary-wrap span') : '',
      activeText: inner ? txt(inner, 'span.active-text') : '',
      baseInfo: inner ? txts(inner, 'div.base-info span') : [],
      expect: inner ? txts(inner, 'div.expect-wrap span.content div.join-text-wrap span') : [],
      advantage: inner ? txt(inner, 'div.geek-desc span.content') : '',
      tags: inner ? txts(inner, 'div.tags-wrap span.tag-item') : [],
      inViewport,
      interactable
    }
  })
}

/**
 * 抓主候选卡（已过滤 similar/promo/无 id），归一化。
 * @param {import('puppeteer').Frame} frame
 * @returns {Promise<Array<object>>}
 */
export async function scrapeCards (frame) {
  if (!frame) return []
  const raw = await frame.evaluate(extractRawCardsInFrame).catch(() => [])
  return raw.filter(isPrimaryCard).map(mapRawCard)
}

// LIVE-SMOKE PENDING: launch browser, navigate to recommend page, call scrapeCards(frame),
// log first 3 results — confirm name/salary/education populate and similar-geek cards are excluded
