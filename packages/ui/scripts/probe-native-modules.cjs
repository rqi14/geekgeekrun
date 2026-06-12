'use strict'

// Probe runs under Electron's binary (ELECTRON_RUN_AS_NODE=1), so
// process.versions.modules reflects Electron's ABI — exactly what the
// app will see at runtime. If require('better-sqlite3') throws here,
// the compiled .node has the wrong ABI and must be rebuilt.

const probes = [
  {
    name: 'better-sqlite3',
    run() {
      const Database = require('better-sqlite3')
      const db = new Database(':memory:')
      const row = db.prepare('select sqlite_version() as v').get()
      db.close()
      return 'sqlite ' + row.v
    }
  }
]

const failures = []
const successes = []

for (const probe of probes) {
  try {
    const info = probe.run()
    successes.push(probe.name + ' (' + info + ')')
  } catch (e) {
    failures.push({ name: probe.name, message: (e && e.message) || String(e) })
  }
}

const header = '[probe] electron=' + process.versions.electron + ' modules=' + process.versions.modules

if (failures.length === 0) {
  process.stdout.write(header + ' OK: ' + successes.join(', ') + '\n')
  process.exit(0)
}

process.stderr.write(header + ' FAIL\n')
for (const f of failures) {
  process.stderr.write('  - ' + f.name + ': ' + f.message + '\n')
}
process.exit(2)
