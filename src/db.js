import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

let cache = null
let loadedAt = 0
const queue = []
let writing = false

function ensureDir (p) {
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function loadFile (file) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return { meta: { migrations: [] }, users: [], cases: [] }
    throw e
  }
}

async function writeFileAtomic (file, data) {
  ensureDir(file)
  const tmp = `${file}.tmp-${randomUUID()}`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

async function drain () {
  if (writing) return
  writing = true
  while (queue.length) {
    const job = queue.shift()
    try { await job() } catch (e) { console.error('DB write error', e) }
  }
  writing = false
}

export function createJsonDb (file) {
  const filepath = path.resolve(file)
  return {
    async load () {
      if (!cache || Date.now() - loadedAt > 1000) {
        cache = await loadFile(filepath)
        loadedAt = Date.now()
      }
      return cache
    },
    async tx (fn) {
      const run = async () => {
        const db = await loadFile(filepath)
        const res = await fn(db)
        await writeFileAtomic(filepath, db)
        cache = db
        loadedAt = Date.now()
        return res
      }
      return new Promise((resolve, reject) => {
        queue.push(async () => { try { resolve(await run()) } catch (e) { reject(e) } })
        drain()
      })
    }
  }
}
