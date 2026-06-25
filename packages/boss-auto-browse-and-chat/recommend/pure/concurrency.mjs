/**
 * 并发池：限制同时在跑的异步任务数量。用于 B 相"串行抽简历 + 并发评分"——
 * 浏览器抽取仍然串行（单页面），但每抽到一份简历就把 LLM 评分丢进池里并发跑，
 * 池子封顶 `limit`（默认 4）以免触发模型供应商限流。
 *
 * schedule(thunk) 返回一个 Promise，resolve/reject 为 thunk 的结果/异常；
 * 单个 thunk 抛错只 reject 它自己，不影响池中其它任务。调用方把 schedule(...) 收进
 * 数组再 Promise.all，即可按调度顺序拿到结果。
 *
 * @param {number} limit 最大并发数（<1 或非法值会被夹到 1）
 * @returns {(thunk:() => Promise<any>) => Promise<any>}
 */
export function createPool (limit) {
  const max = Math.max(1, Math.floor(limit) || 1)
  let active = 0
  const queue = []
  const pump = () => {
    while (active < max && queue.length) {
      const { thunk, resolve, reject } = queue.shift()
      active++
      Promise.resolve()
        .then(thunk)
        .then(
          (v) => { active--; resolve(v); pump() },
          (e) => { active--; reject(e); pump() }
        )
    }
  }
  return function schedule (thunk) {
    return new Promise((resolve, reject) => {
      queue.push({ thunk, resolve, reject })
      pump()
    })
  }
}
