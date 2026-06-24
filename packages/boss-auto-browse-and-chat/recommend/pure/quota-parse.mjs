const firstInt = (s) => {
  const m = String(s ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}
const totalInt = (s) => {
  const m = String(s ?? '').match(/共\s*(\d+)/)
  return m ? Number(m[1]) : null
}

function parseRow (row) {
  if (!row) return null
  const used = firstInt(row.usingText)
  const total = totalInt(row.totalText)
  if (used == null || total == null) return null
  return { used, total, remaining: Math.max(0, total - used) }
}

/**
 * 解析"权益使用量"里查看/沟通两行 → 各自 used/total/remaining；解析不出返回 null。
 * @param {Array<{name:string, usingText:string, totalText:string}>} rows
 * @returns {{view:({used:number,total:number,remaining:number}|null), greet:(object|null)}}
 */
export function parseQuotaUsage (rows) {
  const list = Array.isArray(rows) ? rows : []
  const find = (needle) =>
    list.find((r) => r && typeof r.name === 'string' && r.name.includes(needle))
  return {
    view: parseRow(find('查看')),
    greet: parseRow(find('沟通'))
  }
}
