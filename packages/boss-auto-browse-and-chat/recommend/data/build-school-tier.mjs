/**
 * 生成 cn-school-tier.json（学校层级数据，用于卡片层"学校水平"判定）。
 *
 * 数据源：DaoSword/China-Education-Data 高等教育数据宽表 v20230118
 *   https://github.com/DaoSword/China-Education-Data
 * 仅中国大陆高校（~3018 所）。海外院校不在内，调用方按"无记录"处理。
 *
 * 用法（一次性/刷新时）：
 *   curl -sL "<raw csv url>" -o /tmp/cn-edu.csv
 *   node recommend/data/build-school-tier.mjs /tmp/cn-edu.csv
 * 产出 recommend/data/cn-school-tier.json：
 *   [{ name, aliases:[...], p985, p211, syl, level, province }]
 *   p985/p211/syl 为布尔；level 为 本科/专科；分级(tier)由 school-tier.mjs 运行时派生。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 极简 RFC4180 CSV 解析（处理引号内逗号/双引号转义/CRLF），返回行数组（每行字段数组） */
function parseCsv (text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c === '\r') {
      // skip; \n 收尾
    } else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

const truthy = (v) => {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === '1.0' || s === 'true' || s === '是'
}

const csvPath = process.argv[2]
if (!csvPath) { console.error('用法: node build-school-tier.mjs <csv路径>'); process.exit(1) }

const text = readFileSync(csvPath, 'utf8')
const rows = parseCsv(text)
const header = rows[0]
const idx = (name) => header.indexOf(name)

const iName = idx('学校名称')
const iLevel = idx('办学层次')
const iProvince = idx('所在省份')
const iSyl = idx('双一流建设')
const i985 = idx('985工程')
const i211 = idx('211工程')
const iAbbr = idx('学校简称')
const iFormer = idx('曾用名')

if ([iName, iLevel, iSyl, i985, i211].some((i) => i < 0)) {
  console.error('CSV 表头缺列，实际表头：', header.slice(0, 10), '...')
  process.exit(1)
}

const splitAliases = (s) =>
  String(s ?? '')
    .split(/[,，、;；/]/)
    .map((x) => x.trim())
    .filter(Boolean)

const out = []
for (let r = 1; r < rows.length; r++) {
  const row = rows[r]
  const name = (row[iName] || '').trim()
  if (!name) continue
  const aliases = [...new Set([...splitAliases(row[iAbbr]), ...splitAliases(row[iFormer])])].filter(
    (a) => a && a !== name
  )
  out.push({
    name,
    aliases,
    p985: truthy(row[i985]),
    p211: truthy(row[i211]),
    syl: truthy(row[iSyl]),
    level: (row[iLevel] || '').trim() || null,
    province: (row[iProvince] || '').trim() || null
  })
}

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, 'cn-school-tier.json')
writeFileSync(outPath, JSON.stringify(out))
const n985 = out.filter((x) => x.p985).length
const n211 = out.filter((x) => x.p211).length
const nSyl = out.filter((x) => x.syl).length
console.log(`写出 ${out.length} 所 → ${outPath}（985:${n985} 211:${n211} 双一流:${nSyl}）`)
