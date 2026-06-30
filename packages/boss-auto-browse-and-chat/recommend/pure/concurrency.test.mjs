import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPool, createRetryingPool } from './concurrency.mjs'

function deferred () {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

test('createPool：全部 thunk 解析为各自结果，顺序由调用方数组保留', async () => {
  const schedule = createPool(2)
  const results = await Promise.all([1, 2, 3, 4].map((n) => schedule(async () => n * 10)))
  assert.deepEqual(results, [10, 20, 30, 40])
})

test('createPool：同时在跑的任务数不超过 limit', async () => {
  const limit = 2
  const schedule = createPool(limit)
  let active = 0
  let peak = 0
  const gates = []
  const tasks = []
  for (let i = 0; i < 6; i++) {
    const gate = deferred()
    gates.push(gate)
    tasks.push(
      schedule(async () => {
        active++
        peak = Math.max(peak, active)
        await gate.promise
        active--
        return i
      })
    )
  }
  await tick()
  assert.equal(active, limit, '初始应恰好有 limit 个在跑')
  for (const g of gates) {
    g.resolve()
    await tick()
  }
  await Promise.all(tasks)
  assert.ok(peak <= limit, `峰值 ${peak} 不应超过 ${limit}`)
  assert.equal(active, 0)
})

test('createPool：单个 thunk 抛错只 reject 自己，不影响其它', async () => {
  const schedule = createPool(2)
  const settled = await Promise.allSettled([
    schedule(async () => {
      throw new Error('boom')
    }),
    schedule(async () => 'ok')
  ])
  assert.equal(settled[0].status, 'rejected')
  assert.equal(settled[0].reason.message, 'boom')
  assert.equal(settled[1].status, 'fulfilled')
  assert.equal(settled[1].value, 'ok')
})

test('createPool：limit 大于任务数也能正常完成', async () => {
  const schedule = createPool(10)
  const results = await Promise.all([schedule(async () => 'a'), schedule(async () => 'b')])
  assert.deepEqual(results, ['a', 'b'])
})

test('createPool：limit 为 0/负数被夹到 1，不死锁', async () => {
  const schedule = createPool(0)
  const results = await Promise.all([schedule(async () => 1), schedule(async () => 2)])
  assert.deepEqual(results, [1, 2])
})

// ---------- createRetryingPool ----------

test('createRetryingPool：shouldRetry=false 时不重试，worker 只跑一次', async () => {
  const submit = createRetryingPool({ concurrency: 2, maxAttempts: 3, shouldRetry: () => false })
  let calls = 0
  const r = await submit(async () => { calls++; return 'ok' })
  assert.equal(r, 'ok')
  assert.equal(calls, 1)
})

test('createRetryingPool：失败结果重试到成功，返回最终结果', async () => {
  // 前两次返回 llmError，第三次成功
  const submit = createRetryingPool({
    concurrency: 1,
    maxAttempts: 3,
    shouldRetry: (res) => res.llmError === true
  })
  let attempt = 0
  const r = await submit(async (a) => {
    attempt = a
    return a < 3 ? { llmError: true, score: 0 } : { llmError: false, score: 88 }
  })
  assert.deepEqual(r, { llmError: false, score: 88 })
  assert.equal(attempt, 3)
})

test('createRetryingPool：重试用尽仍失败 → 返回最后一次（兜底）结果', async () => {
  const submit = createRetryingPool({
    concurrency: 1,
    maxAttempts: 2,
    shouldRetry: (res) => res.llmError === true
  })
  let calls = 0
  const r = await submit(async () => { calls++; return { llmError: true, score: 0 } })
  assert.deepEqual(r, { llmError: true, score: 0 })
  assert.equal(calls, 2, '首次 + 1 次重试 = 2')
})

test('createRetryingPool：worker 抛错也重试；全抛则 reject', async () => {
  const submit = createRetryingPool({ concurrency: 1, maxAttempts: 3 })
  let calls = 0
  await assert.rejects(
    submit(async () => { calls++; throw new Error('boom') }),
    /boom/
  )
  assert.equal(calls, 3)
})

test('createRetryingPool：backoffMs 被以 attempt 调用，sleep 被等待', async () => {
  const backoffArgs = []
  const sleeps = []
  const submit = createRetryingPool({
    concurrency: 1,
    maxAttempts: 3,
    shouldRetry: (res) => res.llmError === true,
    backoffMs: (attempt) => { backoffArgs.push(attempt); return attempt * 10 },
    sleep: async (ms) => { sleeps.push(ms) }
  })
  await submit(async (a) => (a < 3 ? { llmError: true } : { llmError: false }))
  assert.deepEqual(backoffArgs, [1, 2], 'attempt 1、2 失败各算一次退避')
  assert.deepEqual(sleeps, [10, 20])
})

test('createRetryingPool：并发峰值不超过 concurrency（含重试期间）', async () => {
  let active = 0
  let peak = 0
  const submit = createRetryingPool({
    concurrency: 2,
    maxAttempts: 2,
    shouldRetry: (res) => res.retry === true,
    backoffMs: () => 0
  })
  const mk = (failFirst) => submit(async (a) => {
    active++
    peak = Math.max(peak, active)
    await tick()
    active--
    return { retry: failFirst && a === 1 }
  })
  await Promise.all([mk(true), mk(true), mk(false), mk(true), mk(false)])
  assert.ok(peak <= 2, `峰值 ${peak} 不应超过 2`)
})

test('createPool 仍等价于 maxAttempts=1（无重试）', async () => {
  const schedule = createPool(2)
  let calls = 0
  const r = await schedule(async () => { calls++; return 'x' })
  assert.equal(r, 'x')
  assert.equal(calls, 1)
})
