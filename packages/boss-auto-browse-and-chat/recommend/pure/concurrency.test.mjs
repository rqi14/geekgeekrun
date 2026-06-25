import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPool } from './concurrency.mjs'

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
