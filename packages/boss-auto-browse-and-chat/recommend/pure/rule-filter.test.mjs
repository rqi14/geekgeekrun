import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ruleFilterList } from './rule-filter.mjs'

const cfg = { expectEducationList: ['硕士', '博士'], expectSalaryRange: [10, 30], expectSalaryWhenNegotiable: 'include' }

test('passes a matching candidate', () => {
  const c = { encryptGeekId: 'a', geekName: '甲', education: '硕士', salary: '10-15K' }
  assert.deepEqual(ruleFilterList(c, cfg), { result: 'pass' })
})
test('rejects on education with reason', () => {
  const c = { encryptGeekId: 'b', geekName: '乙', education: '本科', salary: '10-15K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'education')
})
test('rejects on salary too high', () => {
  const c = { encryptGeekId: 'c', geekName: '丙', education: '硕士', salary: '40-50K' }
  const r = ruleFilterList(c, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'salary')
})

const schoolCfg = { expectSchoolKeywords: ['双一流', 'QS', '浙江大学'] }
test('school: passes when a tier tag matches', () => {
  const c = { encryptGeekId: 'd', geekName: '丁', tags: ['QS前500院校', '食品研发'], schools: ['某学院'] }
  assert.deepEqual(ruleFilterList(c, schoolCfg), { result: 'pass' })
})
test('school: passes when a school name matches', () => {
  const c = { encryptGeekId: 'e', geekName: '戊', tags: [], schools: ['浙江大学', '浙江工商大学'] }
  assert.deepEqual(ruleFilterList(c, schoolCfg), { result: 'pass' })
})
test('school: rejects when neither tags nor schools match', () => {
  const c = { encryptGeekId: 'f', geekName: '己', tags: ['食品研发'], schools: ['某不知名学院'] }
  const r = ruleFilterList(c, schoolCfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'school')
})
test('school: rejects when candidate has no school/tag data', () => {
  const c = { encryptGeekId: 'g', geekName: '庚' }
  const r = ruleFilterList(c, schoolCfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'school')
})

const majorCfg = { expectMajorKeywords: ['食品', '化学'] }
test('major: passes on substring match', () => {
  const c = { encryptGeekId: 'h', geekName: '辛', majors: ['食品科学与工程'] }
  assert.deepEqual(ruleFilterList(c, majorCfg), { result: 'pass' })
})
test('major: rejects when no major matches', () => {
  const c = { encryptGeekId: 'i', geekName: '壬', majors: ['法学'] }
  const r = ruleFilterList(c, majorCfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'major')
})

test('customRules: reject on keyword hit unless exception hits', () => {
  const cfg = {
    customRules: [{
      field: 'all',
      operator: 'containsAny',
      keywords: ['分子生物', 'PCR'],
      action: 'reject',
      except: { field: 'all', operator: 'containsAny', keywords: ['液滴微流控'] }
    }]
  }

  const rejected = ruleFilterList({
    encryptGeekId: 'j',
    geekName: '癸',
    majors: ['分子生物学'],
    skills: 'PCR'
  }, cfg)
  assert.equal(rejected.result, 'reject')
  assert.equal(rejected.reason, 'customRule')

  const kept = ruleFilterList({
    encryptGeekId: 'k',
    geekName: '子',
    majors: ['分子生物学'],
    skills: 'PCR 液滴微流控'
  }, cfg)
  assert.deepEqual(kept, { result: 'pass' })
})

test('customRules: notContainsAny rejects missing required school tag', () => {
  const cfg = {
    customRules: [{
      field: 'school',
      operator: 'notContainsAny',
      keywords: ['985', '211', '双一流'],
      action: 'reject'
    }]
  }
  const r = ruleFilterList({ encryptGeekId: 'l', geekName: '丑', schools: ['普通学院'], tags: [] }, cfg)
  assert.equal(r.result, 'reject')
  assert.equal(r.reason, 'customRule')
})

test('customRules: school field can fall back to resumeText for chat flow', () => {
  const cfg = {
    customRules: [{
      field: 'school',
      operator: 'notContainsAny',
      keywords: ['985', '双一流'],
      action: 'reject'
    }]
  }
  const r = ruleFilterList({
    encryptGeekId: 'm',
    geekName: '寅',
    resumeText: '教育经历：浙江大学，985，双一流。'
  }, cfg)
  assert.deepEqual(r, { result: 'pass' })
})
