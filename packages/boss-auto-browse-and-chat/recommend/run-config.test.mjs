import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecommendCfgAndLlm } from './run-config.mjs'

const rubric = {
  passThreshold: 72,
  knockouts: [],
  dimensions: [{ name: '能力匹配', weight: 100, criteria: { 1: '弱', 3: '中', 5: '强' } }]
}

test('recommend explicit minScoreToChat overrides rubric passThreshold', async () => {
  const { recCfg } = await buildRecommendCfgAndLlm({
    config: {
      scoring: {
        enabled: true,
        rubric,
        minScoreToChat: 40,
        onScoreError: 'skip'
      }
    },
    recommendPageOpts: {},
    filterConfig: {},
    maxChatPerRun: 10
  })

  assert.equal(recCfg.minScoreToChat, 40)
  assert.deepEqual(recCfg.llm.rubric, rubric)
})

test('recommend falls back to rubric passThreshold when minScoreToChat is unset', async () => {
  const { recCfg } = await buildRecommendCfgAndLlm({
    config: {
      scoring: {
        enabled: true,
        rubric,
        onScoreError: 'skip'
      }
    },
    recommendPageOpts: {},
    filterConfig: {},
    maxChatPerRun: 10
  })

  assert.equal(recCfg.minScoreToChat, 72)
  assert.deepEqual(recCfg.llm.rubric, rubric)
})
