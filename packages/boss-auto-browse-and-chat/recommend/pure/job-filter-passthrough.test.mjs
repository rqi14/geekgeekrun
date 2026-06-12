import { test } from 'node:test'
import assert from 'node:assert/strict'
import { __jobFilterToCandidateFilter } from '../../runtime-file-utils.mjs'

test('passes through skills/school/major/blockName/skipViewed', () => {
  const out = __jobFilterToCandidateFilter({
    expectSkillKeywords: ['LC-MS'],
    expectSchoolKeywords: ['双一流'],
    expectMajorKeywords: ['食品'],
    blockCandidateNameRegExpStr: '^张',
    skipViewedCandidates: true
  })
  assert.deepEqual(out.expectSkillKeywords, ['LC-MS'])
  assert.deepEqual(out.expectSchoolKeywords, ['双一流'])
  assert.deepEqual(out.expectMajorKeywords, ['食品'])
  assert.equal(out.blockCandidateNameRegExpStr, '^张')
  assert.equal(out.skipViewedCandidates, true)
})
test('defaults are empty when fields absent', () => {
  const out = __jobFilterToCandidateFilter({})
  assert.deepEqual(out.expectSkillKeywords, [])
  assert.deepEqual(out.expectSchoolKeywords, [])
  assert.deepEqual(out.expectMajorKeywords, [])
  assert.equal(out.blockCandidateNameRegExpStr, '')
  assert.equal(out.skipViewedCandidates, false)
})
