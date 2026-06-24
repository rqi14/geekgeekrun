import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fieldKnockout } from './field-knockout.mjs'

const cfg = {
  exclude: ['分子生物', '细胞生物', '生物化学', '免疫', 'CRISPR', '基因测序', 'PCR'],
  include: ['化工', '化学工程', '化学', '材料', '高分子', '颗粒', '微球', '乳化', '液滴微流控', '自组装', '纳米纤维', '矿化', '冻干', '制剂']
}

test('纯分子生物背景 → knockout', () => {
  const r = fieldKnockout(
    { majors: ['生物化学与分子生物学', '动物科学'], advantage: '肿瘤免疫 CRISPR 类器官 qPCR' },
    cfg
  )
  assert.equal(r.result, 'knockout'); assert.equal(r.via, 'exclude')
})

test('化工对口 → keep', () => {
  const r = fieldKnockout(
    { majors: ['化学工程与工业生物工程', '生物工程'], expectDirection: '化工' },
    cfg
  )
  assert.equal(r.result, 'keep'); assert.equal(r.via, 'include')
})

test('例外压过排除：细胞生物学但做液滴微流控/微球 → keep', () => {
  const r = fieldKnockout(
    { majors: ['细胞生物学'], advantage: '做液滴微流控制备微球' },
    cfg
  )
  assert.equal(r.result, 'keep'); assert.equal(r.via, 'include')
})

test('既不排除也不包含 → gray', () => {
  const r = fieldKnockout({ majors: ['会计学'], advantage: '财务报表' }, cfg)
  assert.equal(r.result, 'gray')
})

test('英文关键词大小写不敏感', () => {
  const r = fieldKnockout({ majors: ['Cell Biology'], advantage: 'crispr screening' }, { exclude: ['CRISPR'], include: [] })
  assert.equal(r.result, 'knockout')
})

test('未配置 include/exclude → 一律 gray', () => {
  assert.equal(fieldKnockout({ majors: ['生物化学'] }, {}).result, 'gray')
  assert.equal(fieldKnockout({ majors: ['生物化学'] }, { include: [], exclude: [] }).result, 'gray')
})

test('字段缺失安全', () => {
  assert.equal(fieldKnockout({}, cfg).result, 'gray')
  assert.equal(fieldKnockout(null, cfg).result, 'gray')
})
