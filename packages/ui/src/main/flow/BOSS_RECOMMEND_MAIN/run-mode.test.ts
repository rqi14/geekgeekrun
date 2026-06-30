import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecommendWorkerRunMode } from './run-mode.ts'

test('recommend worker is always single-run by default', () => {
  assert.deepEqual(buildRecommendWorkerRunMode({}), {
    keepBrowserOpenAfterRun: false,
    returnBrowser: false,
    shouldRerunAfterComplete: false
  })
})

test('keeping browser open does not enable reruns', () => {
  assert.deepEqual(
    buildRecommendWorkerRunMode({
      recommendPage: {
        keepBrowserOpenAfterRun: true
      }
    }),
    {
      keepBrowserOpenAfterRun: true,
      returnBrowser: true,
      shouldRerunAfterComplete: false
    }
  )
})
