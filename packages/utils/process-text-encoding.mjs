import { execFileSync } from 'node:child_process'

const UTF8_LOCALE = 'C.UTF-8'

function isUtf8Locale(value) {
  return typeof value === 'string' && /utf-?8|65001/i.test(value)
}

function setWritableDefaultEncoding(stream) {
  if (stream && typeof stream.setDefaultEncoding === 'function') {
    stream.setDefaultEncoding('utf8')
  }
}

function setReadableEncoding(stream) {
  if (stream && typeof stream.setEncoding === 'function') {
    stream.setEncoding('utf8')
  }
}

export function buildUtf8ProcessEnv(baseEnv = process.env) {
  const nextEnv = { ...baseEnv }

  if (!isUtf8Locale(nextEnv.LANG)) {
    nextEnv.LANG = UTF8_LOCALE
  }
  if (!isUtf8Locale(nextEnv.LC_CTYPE)) {
    nextEnv.LC_CTYPE = nextEnv.LANG
  }
  nextEnv.PYTHONIOENCODING = 'utf-8'
  nextEnv.PYTHONUTF8 = '1'
  nextEnv.LESSCHARSET = 'utf-8'

  return nextEnv
}

export function normalizeProcessTextEncoding({
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  setConsoleCodePage = process.platform === 'win32'
} = {}) {
  Object.assign(env, buildUtf8ProcessEnv(env))
  setReadableEncoding(stdin)
  setWritableDefaultEncoding(stdout)
  setWritableDefaultEncoding(stderr)

  if (setConsoleCodePage) {
    try {
      execFileSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 >nul'], {
        stdio: 'ignore',
        windowsHide: true
      })
    } catch {
      // No attached console, or chcp is unavailable. The stream/env changes above still help.
    }
  }
}
