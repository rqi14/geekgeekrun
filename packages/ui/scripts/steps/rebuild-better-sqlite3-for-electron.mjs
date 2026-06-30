import childProcess from 'node:child_process'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

/**
 * 把 better-sqlite3 的原生二进制重建/拉取为「当前 ui 所用 electron」的 ABI。
 *
 * 为什么需要：
 * - better-sqlite3 不是 N-API 模块，二进制按 NODE_MODULE_VERSION（ABI）区分。
 * - 它自身的 install 脚本（prebuild-install）默认按「当前运行的 node」拉预编译包，
 *   于是 `pnpm install` 后留下的是 node 版本的二进制（如 ABI 137），electron 39
 *   需要的是 ABI 140 —— 直接 `new Database()` 会抛 NODE_MODULE_VERSION 不匹配。
 * - 项目本应由 `electron-builder install-app-deps` 修正，但在 pnpm 的 symlink 布局下
 *   它找不到 prebuild-install（报 “cannot find prebuild-install”），导致不生效。
 *
 * 本步骤显式地以 electron runtime 调用 prebuild-install，按 ui 实际安装的 electron
 * 版本拉取对应 ABI 的预编译二进制，保证每次安装后二进制都与 electron 对齐。
 */
export default function rebuildBetterSqlite3ForElectron() {
  const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
  const uiRoot = path.join(__dirname, '../..')
  const uiRequire = createRequire(path.join(uiRoot, 'package.json'))

  let electronVersion
  let betterSqlite3Dir
  let prebuildInstallBin
  try {
    // electron 是 ui 的直接 devDependency，从 ui 视角解析
    electronVersion = uiRequire('electron/package.json').version
    // better-sqlite3 是 sqlite-plugin 的依赖（不是 ui 的），pnpm 严格布局下需从 sqlite-plugin 视角解析
    const sqlitePluginRequire = createRequire(
      path.join(uiRoot, '../sqlite-plugin/package.json')
    )
    betterSqlite3Dir = path.dirname(
      sqlitePluginRequire.resolve('better-sqlite3/package.json')
    )
    // prebuild-install 是 better-sqlite3 的依赖；从 better-sqlite3 的视角解析最稳妥
    const bsRequire = createRequire(path.join(betterSqlite3Dir, 'package.json'))
    const piPkg = bsRequire('prebuild-install/package.json')
    const piDir = path.dirname(bsRequire.resolve('prebuild-install/package.json'))
    const piBinRel =
      typeof piPkg.bin === 'string' ? piPkg.bin : piPkg.bin['prebuild-install']
    prebuildInstallBin = path.join(piDir, piBinRel)
  } catch (error) {
    console.error('[rebuild-better-sqlite3-for-electron] 解析依赖路径失败：', error)
    process.exit(1)
  }

  const arch = process.arch
  console.log(
    `[rebuild-better-sqlite3-for-electron] 为 electron@${electronVersion} (${arch}) 拉取 better-sqlite3 预编译二进制...`
  )

  const result = childProcess.spawnSync(
    process.execPath,
    [prebuildInstallBin, '-r', 'electron', '-t', electronVersion, '--arch', arch],
    { cwd: betterSqlite3Dir, stdio: ['inherit', 'inherit', 'inherit'] }
  )

  if (result.status === 0) {
    console.log('[rebuild-better-sqlite3-for-electron] 完成。')
    return
  }

  // 兜底：electron 该版本若无预编译包，回退到 electron-builder install-app-deps（从源码编译，需要 C++ 工具链）
  console.warn(
    '[rebuild-better-sqlite3-for-electron] prebuild-install 失败，回退到 electron-builder install-app-deps...'
  )
  const fallback = childProcess.spawnSync('electron-builder install-app-deps', {
    cwd: uiRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: true
  })
  if (fallback.status !== 0) {
    console.error(
      '[rebuild-better-sqlite3-for-electron] 无法为 electron 重建 better-sqlite3，运行时会因 ABI 不匹配崩溃。'
    )
    process.exit(1)
  }
}
