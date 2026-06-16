import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import {
  buildUtf8ProcessEnv,
  normalizeProcessTextEncoding
} from './process-text-encoding.mjs'

const require = createRequire(import.meta.url)
const cjsEncoding = require('./process-text-encoding.cjs')

function fakeWritableStream() {
  return {
    defaultEncoding: null,
    setDefaultEncoding(encoding) {
      this.defaultEncoding = encoding
    }
  }
}

function fakeReadableStream() {
  return {
    encoding: null,
    setEncoding(encoding) {
      this.encoding = encoding
    }
  }
}

test('normalizeProcessTextEncoding configures stdio streams and child process env for UTF-8', () => {
  const env = {}
  const stdin = fakeReadableStream()
  const stdout = fakeWritableStream()
  const stderr = fakeWritableStream()

  normalizeProcessTextEncoding({
    env,
    stdin,
    stdout,
    stderr,
    setConsoleCodePage: false
  })

  assert.equal(stdin.encoding, 'utf8')
  assert.equal(stdout.defaultEncoding, 'utf8')
  assert.equal(stderr.defaultEncoding, 'utf8')
  assert.equal(env.LANG, 'C.UTF-8')
  assert.equal(env.LC_CTYPE, 'C.UTF-8')
  assert.equal(env.PYTHONIOENCODING, 'utf-8')
  assert.equal(env.PYTHONUTF8, '1')
  assert.equal(env.LESSCHARSET, 'utf-8')
})

test('buildUtf8ProcessEnv preserves existing UTF-8 locale values', () => {
  const env = buildUtf8ProcessEnv({
    LANG: 'zh_CN.UTF-8',
    LC_CTYPE: 'Chinese_China.65001',
    PYTHONIOENCODING: 'gbk'
  })

  assert.equal(env.LANG, 'zh_CN.UTF-8')
  assert.equal(env.LC_CTYPE, 'Chinese_China.65001')
  assert.equal(env.PYTHONIOENCODING, 'utf-8')
  assert.equal(env.PYTHONUTF8, '1')
})

test('CommonJS and ESM helpers build the same child process env', () => {
  const baseEnv = {
    LANG: 'C',
    LC_CTYPE: '',
    PYTHONIOENCODING: 'gbk'
  }

  assert.deepEqual(cjsEncoding.buildUtf8ProcessEnv(baseEnv), buildUtf8ProcessEnv(baseEnv))
})

test('child process receives UTF-8 env from buildUtf8ProcessEnv', () => {
  const env = buildUtf8ProcessEnv({ PATH: process.env.PATH })
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      "process.stdout.write([process.env.LANG, process.env.LC_CTYPE, process.env.PYTHONIOENCODING, process.env.PYTHONUTF8, process.env.LESSCHARSET].join('\\n'))"
    ],
    {
      env,
      encoding: 'utf8'
    }
  ).split('\n')

  assert.deepEqual(output, ['C.UTF-8', 'C.UTF-8', 'utf-8', '1', 'utf-8'])
})

test('register module normalizes process env as an import side effect', () => {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import './packages/utils/process-text-encoding-register.mjs'; process.stdout.write([process.env.LANG, process.env.PYTHONUTF8].join('\\n'))"
    ],
    {
      cwd: new URL('../..', import.meta.url),
      env: { PATH: process.env.PATH },
      encoding: 'utf8'
    }
  ).split('\n')

  assert.deepEqual(output, ['C.UTF-8', '1'])
})
