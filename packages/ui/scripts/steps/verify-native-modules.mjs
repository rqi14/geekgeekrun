import { spawnSync } from 'node:child_process'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const uiDir = path.resolve(__dirname, '../..')
const probePath = path.join(__dirname, '..', 'probe-native-modules.cjs')

function getElectronBinary() {
  return require('electron')
}

export function runProbe() {
  const electronPath = getElectronBinary()
  const res = spawnSync(electronPath, [probePath], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    cwd: uiDir
  })
  return res.status === 0
}

function printRebuildHint() {
  console.error('')
  console.error('[verify-native-modules] Native module ABI does not match Electron.')
  console.error('  This usually happens after Electron is upgraded or a fresh install.')
  console.error('  Fix it with one of:')
  console.error('    pnpm -F geekgeekrun-ui rebuild:native')
  console.error('    pnpm -F geekgeekrun-ui exec electron-rebuild -f -w better-sqlite3')
  console.error('')
}

export default function verifyNativeModules() {
  if (runProbe()) return true
  printRebuildHint()
  return false
}
