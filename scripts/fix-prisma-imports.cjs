'use strict'
const fs = require('fs')
const path = require('path')

function walk(d, a = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, a)
    else if (p.endsWith('.ts')) a.push(p)
  }
  return a
}

for (const f of walk(path.join(__dirname, '..', 'apps', 'api', 'src'))) {
  let s = fs.readFileSync(f, 'utf8')
  const orig = s
  s = s.replace(
    /import \{\r?\nimport \{ prisma \} from '([^']+)'\r?\n([\s\S]*?)\} from '([^']+)'/g,
    (_m, prismaPath, body, fromPath) =>
      `import { prisma } from '${prismaPath}'\nimport {\n${body}} from '${fromPath}'`,
  )
  if (s !== orig) {
    fs.writeFileSync(f, s)
    console.log('fixed', f)
  }
}
console.log('done')
