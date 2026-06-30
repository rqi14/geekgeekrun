import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOption, planNativeFilter, NATIVE_FILTER_CATALOG } from './native-filter.mjs'

// 注入 fixture catalog，使单测不依赖生产真值
const CAT = {
  degree: { groupClass: 'degree', vip: false, single: false, options: ['大专', '本科', '硕士', '博士'] },
  salary: { groupClass: 'salary', vip: false, single: true, options: ['5-10K', '10-20K', '20-50K'] },
  school: { groupClass: 'school', vip: true, single: false, options: ['985', '211', '双一流院校'] },
  major: { groupClass: 'major', vip: true, single: false, options: null } // 动态（按职位变）
}

test('normalizeOption 去掉前后/中间空白与换行', () => {
  assert.equal(normalizeOption('\n    本科\n'), '本科')
  assert.equal(normalizeOption('本 科'), '本科')
  assert.equal(normalizeOption('1-3年'), '1-3年')
})

test('normalizeOption 容错 null/undefined', () => {
  assert.equal(normalizeOption(null), '')
  assert.equal(normalizeOption(undefined), '')
})

test('enabled:false / 缺省 → 空计划', () => {
  assert.deepEqual(planNativeFilter({ enabled: false, degree: ['本科'] }, CAT), { apply: [], skipped: [] })
  assert.deepEqual(planNativeFilter(undefined, CAT), { apply: [], skipped: [] })
})

test('多选维度：合法项进 apply（存原始 catalog 文案）', () => {
  const p = planNativeFilter({ degree: ['本科', '硕士'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科', '硕士'] }])
  assert.deepEqual(p.skipped, [])
})

test('多选维度：非法项进 skipped，合法项仍 apply', () => {
  const p = planNativeFilter({ degree: ['本科', '专科'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科'] }])
  assert.deepEqual(p.skipped, [{ group: 'degree', value: '专科', reason: 'unknown-option' }])
})

test('全非法 → apply 空、全 skipped', () => {
  const p = planNativeFilter({ degree: ['x', 'y'] }, CAT)
  assert.deepEqual(p.apply, [])
  assert.equal(p.skipped.length, 2)
})

test('单选维度：给数组只取首个', () => {
  const p = planNativeFilter({ salary: ['10-20K', '20-50K'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'salary', single: true, options: ['10-20K'] }])
})

test('单选维度：给字符串照常', () => {
  const p = planNativeFilter({ salary: '10-20K' }, CAT)
  assert.deepEqual(p.apply, [{ group: 'salary', single: true, options: ['10-20K'] }])
})

test('多选维度：给字符串包成单元素', () => {
  const p = planNativeFilter({ school: '985' }, CAT)
  assert.deepEqual(p.apply, [{ group: 'school', single: false, options: ['985'] }])
})

test('空值不进 apply 也不进 skipped', () => {
  const p = planNativeFilter({ degree: [], salary: '', school: null }, CAT)
  assert.deepEqual(p, { apply: [], skipped: [] })
})

test('归一匹配：配置带空格也能命中 catalog 原文', () => {
  const p = planNativeFilter({ degree: ['本 科'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'degree', single: false, options: ['本科'] }])
})

test('动态维度(major, options:null)：原样透传不校验', () => {
  const p = planNativeFilter({ major: ['食品科学类'] }, CAT)
  assert.deepEqual(p.apply, [{ group: 'major', single: false, options: ['食品科学类'] }])
  assert.deepEqual(p.skipped, [])
})

test('生产 catalog 形状自洽：每项含 groupClass/vip/single/options', () => {
  for (const [g, m] of Object.entries(NATIVE_FILTER_CATALOG)) {
    assert.equal(m.groupClass, g)
    assert.equal(typeof m.vip, 'boolean')
    assert.equal(typeof m.single, 'boolean')
    assert.ok(m.options === null || Array.isArray(m.options))
  }
})
