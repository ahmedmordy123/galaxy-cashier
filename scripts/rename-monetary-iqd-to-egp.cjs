'use strict'
/** One-shot codemod: monetary *IQD identifiers → *EGP (skips lockfiles, migrations SQL, legacy env keys). */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', '.next', 'out'])
const SKIP_FILE = /(package-lock\.json|migration\.sql|supabase-seed\.sql|stress-audit|phase2-race)/

const REPLACEMENTS = [
  ['openingBalanceEGP', 'openingBalanceEGP'],
  ['closingBalanceEGP', 'closingBalanceEGP'],
  ['cashSalesEGP', 'cashSalesEGP'],
  ['creditSalesEGP', 'creditSalesEGP'],
  ['salesTotalEGP', 'salesTotalEGP'],
  ['returnsTotalEGP', 'returnsTotalEGP'],
  ['netSalesEGP', 'netSalesEGP'],
  ['cogsTotalEGP', 'cogsTotalEGP'],
  ['grossProfitEGP', 'grossProfitEGP'],
  ['expensesTotalEGP', 'expensesTotalEGP'],
  ['netProfitEGP', 'netProfitEGP'],
  ['revenueEGP', 'revenueEGP'],
  ['amountEGP', 'amountEGP'],
  ['totalEGP', 'totalEGP'],
  ['rateEGP', 'rateEGP'],
]

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, files)
    else if (/\.(ts|tsx|js|cjs|mjs|prisma|md|json|example)$/.test(ent.name) && !SKIP_FILE.test(ent.name)) {
      files.push(p)
    }
  }
  return files
}

let changed = 0
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8')
  let next = text
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to)
  }
  if (next !== text) {
    fs.writeFileSync(file, next)
    changed++
    console.log('updated', path.relative(ROOT, file))
  }
}
console.log(`Done. ${changed} files.`)
