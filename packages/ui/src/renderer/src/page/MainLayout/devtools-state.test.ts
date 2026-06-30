import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEVTOOLS_STORAGE_KEY,
  nextDevToolsState,
  persistDevToolsState,
  shouldAutoOpenDevToolsOnStartup
} from './devtools-state.ts'

function memoryStorage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => data.has(key) ? data.get(key)! : null,
    setItem: (key: string, value: string) => data.set(key, String(value))
  }
}

test('startup restores devtools when the persisted recruiter flag is true', () => {
  const storage = memoryStorage({ [DEVTOOLS_STORAGE_KEY]: 'true' })

  assert.equal(shouldAutoOpenDevToolsOnStartup(storage), true)
})

test('real devtools close event persists false for the next startup', () => {
  const storage = memoryStorage({ [DEVTOOLS_STORAGE_KEY]: 'true' })

  persistDevToolsState(false, storage)

  assert.equal(shouldAutoOpenDevToolsOnStartup(storage), false)
})

test('manual toggle persists the expected next state', () => {
  const storage = memoryStorage()

  assert.equal(nextDevToolsState(false, storage), true)
  assert.equal(storage.getItem(DEVTOOLS_STORAGE_KEY), 'true')
  assert.equal(nextDevToolsState(true, storage), false)
  assert.equal(storage.getItem(DEVTOOLS_STORAGE_KEY), 'false')
})
