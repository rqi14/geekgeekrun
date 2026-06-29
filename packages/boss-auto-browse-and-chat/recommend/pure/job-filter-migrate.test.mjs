import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  migrateJobFilter,
  __jobFilterToChatPageFilter
} from '../../runtime-file-utils.mjs'

const sampleRubric = { knockouts: ['k1'], dimensions: [{ name: 'd1', weight: 1 }], passThreshold: 60 }

test('migrate: old flat resumeLlmEnabled maps to BOTH recommend.scoringEnabled and chat.llmFilterEnabled', () => {
  const m = migrateJobFilter({
    resumeLlmEnabled: true,
    resumeLlmConfig: { rubric: sampleRubric, sourceJd: 'JD here', passThreshold: 60, rubricGenerationModelId: 'mod-1' }
  })
  assert.equal(m.recommend.scoringEnabled, true)
  assert.equal(m.chat.llmFilterEnabled, true)
  assert.deepEqual(m.rubric.dimensions, sampleRubric.dimensions)
  assert.deepEqual(m.rubric.knockouts, sampleRubric.knockouts)
  assert.equal(m.rubric.sourceJd, 'JD here')
  assert.equal(m.rubric.modelId, 'mod-1')
  assert.equal(m.rubric.passThreshold, 60)
})

test('migrate: old resumeKeywords map to chat.keywords; regex preserved as chat.regex', () => {
  const m = migrateJobFilter({
    resumeKeywordsEnabled: true,
    resumeKeywords: ['AKTA'],
    resumeRegExpEnabled: true,
    resumeRegExpStr: '^x'
  })
  assert.equal(m.chat.keywordsEnabled, true)
  assert.deepEqual(m.chat.keywords, ['AKTA'])
  assert.equal(m.chat.regexEnabled, true)
  assert.equal(m.chat.regex, '^x')
})

test('migrate: idempotent — migrate(migrate(x)) deep-equals migrate(x)', () => {
  const once = migrateJobFilter({
    resumeLlmEnabled: true,
    resumeLlmConfig: { rubric: sampleRubric, sourceJd: 'JD', passThreshold: 60 },
    expectCityEnabled: true,
    expectCityList: ['杭州'],
    fieldRules: { include: ['材料'], exclude: [] }
  })
  const twice = migrateJobFilter(once)
  assert.deepEqual(twice, once)
})

test('migrate: preFilter card fields carried over', () => {
  const m = migrateJobFilter({
    expectCityEnabled: true,
    expectCityList: ['杭州'],
    expectSkillKeywords: ['LC-MS'],
    fieldRules: { include: ['材料'], exclude: ['纯生物'] }
  })
  assert.equal(m.preFilter.expectCityEnabled, true)
  assert.deepEqual(m.preFilter.expectCityList, ['杭州'])
  assert.deepEqual(m.preFilter.expectSkillKeywords, ['LC-MS'])
  assert.deepEqual(m.preFilter.fieldRules, { include: ['材料'], exclude: ['纯生物'] })
})

test('migrate: preserves unknown top-level keys', () => {
  const m = migrateJobFilter({ somethingCustom: 42, resumeLlmEnabled: false })
  assert.equal(m.somethingCustom, 42)
})

test('decouple: chat LLM off, recommend scoring on — chat does NOT run llm', () => {
  const f = migrateJobFilter({
    resumeLlmEnabled: true,
    resumeLlmConfig: { rubric: sampleRubric, sourceJd: 'JD', passThreshold: 60 }
  })
  // user turns OFF chat LLM but keeps recommend scoring
  f.chat.llmFilterEnabled = false
  const chatFilter = __jobFilterToChatPageFilter(f)
  assert.equal(chatFilter.mode, 'keywords') // not 'llm'
  assert.equal(chatFilter.llmConfig, null)
})

test('decouple: chat LLM on, recommend scoring off — chat still runs llm with shared rubric', () => {
  const f = migrateJobFilter({
    resumeLlmEnabled: true,
    resumeLlmConfig: { rubric: sampleRubric, sourceJd: 'JD', passThreshold: 60 }
  })
  f.recommend.scoringEnabled = false // recommend off
  // chat.llmFilterEnabled still true
  const chatFilter = __jobFilterToChatPageFilter(f)
  assert.equal(chatFilter.mode, 'llm')
  assert.deepEqual(chatFilter.llmConfig.rubric.dimensions, sampleRubric.dimensions)
  assert.equal(chatFilter.llmConfig.passThreshold, 60)
})

test('chat llm enabled but rubric has no dimensions → falls back to keywords (no crash)', () => {
  const f = migrateJobFilter({})
  f.chat.llmFilterEnabled = true // but no rubric dimensions
  const chatFilter = __jobFilterToChatPageFilter(f)
  assert.equal(chatFilter.mode, 'keywords')
})
