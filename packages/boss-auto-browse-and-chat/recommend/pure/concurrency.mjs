/**
 * 并发池 / 重试队列：限制同时在跑的异步任务数量，并对失败任务做有界自动重试。
 * 用于 B 相"串行抽简历 + 并发评分"——浏览器抽取仍然串行（单页面），但每抽到一份简历
 * 就把 LLM 评分丢进池里并发跑，池子封顶 concurrency（默认 4）以免触发模型供应商限流。
 *
 * 评分调用可能因限流/网络/解析失败而拿到"兜底结果"（llmError 标记）——retrying pool 据
 * shouldRetry 判定把它重新入队重试，最多 maxAttempts 次；退避期间释放并发槽给别的任务。
 * 只对"调用失败"重试，真实的一票否决/低分（shouldRetry=false）不会被重试。
 */

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {object} opts
 * @param {number} opts.concurrency 最大并发数（<1 或非法值夹到 1）
 * @param {number} [opts.maxAttempts=1] 单个任务最多尝试次数（含首次）；1 即不重试
 * @param {(result:any, attempt:number)=>boolean} [opts.shouldRetry] 看 resolve 的结果决定是否重试
 * @param {(attempt:number)=>number} [opts.backoffMs] 第 attempt 次失败后的退避毫秒
 * @param {(ms:number)=>Promise<void>} [opts.sleep] 可注入便于测试
 * @returns {(worker:(attempt:number)=>Promise<any>) => Promise<any>} submit(worker)
 */
export function createRetryingPool ({
  concurrency,
  maxAttempts = 1,
  shouldRetry = () => false,
  backoffMs = () => 0,
  sleep = defaultSleep
} = {}) {
  const max = Math.max(1, Math.floor(concurrency) || 1)
  const attempts = Math.max(1, Math.floor(maxAttempts) || 1)
  let active = 0
  const queue = []

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift()
      active++
      Promise.resolve()
        .then(() => job.worker(job.attempt))
        .then(
          (result) => settle(job, result, null, false),
          (err) => settle(job, undefined, err, true)
        )
    }
  }

  const settle = (job, result, err, failed) => {
    const canRetry = job.attempt < attempts && (failed || shouldRetry(result, job.attempt))
    if (canRetry) {
      const delay = backoffMs(job.attempt)
      job.attempt++
      active-- // 释放并发槽：退避期间不占坑，别的任务可立即补位
      pump()
      const requeue = () => {
        queue.push(job)
        pump()
      }
      if (delay > 0) Promise.resolve(sleep(delay)).then(requeue, requeue)
      else requeue()
      return
    }
    active--
    if (failed) job.reject(err)
    else job.resolve(result)
    pump()
  }

  return function submit (worker) {
    return new Promise((resolve, reject) => {
      queue.push({ worker, attempt: 1, resolve, reject })
      pump()
    })
  }
}

/**
 * 简单并发池（无重试）：createRetryingPool 的瘦封装，保留旧接口。
 * schedule(thunk) 返回 Promise，resolve/reject 为 thunk 的结果/异常。
 * @param {number} limit 最大并发数（<1 或非法值会被夹到 1）
 * @returns {(thunk:() => Promise<any>) => Promise<any>}
 */
export function createPool (limit) {
  const submit = createRetryingPool({ concurrency: limit })
  return (thunk) => submit(() => thunk())
}
