'use strict'
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'apps', 'api', 'src')
const files = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.ts')) files.push(p)
  }
}
walk(root)

let n = 0
for (const f of files) {
  const norm = f.replace(/\\/g, '/')
  if (norm.endsWith('db/prisma.ts')) continue
  if (norm.endsWith('db/ensureSqliteSchema.ts')) continue

  let s = fs.readFileSync(f, 'utf8')
  if (!/const prisma = new PrismaClient\(\)/.test(s)) continue
  const orig = s

  const rel = path.relative(path.dirname(f), path.join(root, 'db', 'prisma')).replace(/\\/g, '/')
  const importPath = (rel.startsWith('.') ? rel : './' + rel).replace(/\.ts$/, '')

  s = s.replace(/\r\n/g, '\n')
  s = s.replace(/\n?const prisma = new PrismaClient\(\)\n/, '\n')

  if (!/from ['"].*db\/prisma['"]/.test(s)) {
    const lines = s.split('\n')
    let insertAt = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) insertAt = i + 1
      else if (insertAt > 0 && !lines[i].startsWith('import ') && lines[i].trim() !== '') break
    }
    lines.splice(insertAt, 0, `import { prisma } from '${importPath}'`)
    s = lines.join('\n')
  }

  s = s.replace(/import \{([^}]+)\} from '@prisma\/client'/g, (full, inner) => {
    const parts = inner
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => x !== 'PrismaClient')
    if (parts.length === 0) return ''
    return `import { ${parts.join(', ')} } from '@prisma/client'`
  })

  s = s.replace(/import \{([^}]+)\} from '@ims-pro\/db'/g, (full, inner) => {
    const parts = inner
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => x !== 'PrismaClient')
    if (parts.length === 0) return ''
    return `import { ${parts.join(', ')} } from '@ims-pro/db'`
  })

  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/\nimport \{ prisma \} from '[^']+'\nimport \{ prisma \} from '[^']+'/g, (m) => {
    const line = m
      .trim()
      .split('\n')
      .find((l) => l.includes('db/prisma'))
    return '\n' + line
  })

  if (s !== orig) {
    fs.writeFileSync(f, s)
    n++
    console.log('updated', path.relative(root, f))
  }
}
console.log('done', n)
