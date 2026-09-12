// T25 extractor: walk the captured session history JSON, find the cordis_inspect_query
// tool-result string (tool-cordis renders JSON.stringify({platform,provider,method,data})),
// un-escape + JSON.parse it, and pretty-print the real client Slots tree.
import { readFileSync, writeFileSync } from 'node:fs'

const raw = readFileSync('D:/1/plan/t25-slot-poc.log', 'utf8')
const hist = JSON.parse(raw)
const records = Array.isArray(hist.records) ? hist.records : []
console.log(`records: ${records.length}`)

const candidates = []
function walk (obj, path) {
  if (typeof obj === 'string') {
    if (obj.includes('Slots') && obj.includes('listSubTree')) candidates.push({ path, value: obj })
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, `${path}[${i}]`))
  } else if (obj !== null && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walk(obj[k], `${path}.${k}`)
  }
}
walk(hist, '$')
console.log(`candidate tool-result strings: ${candidates.length}`)

let saved = 0
for (const c of candidates) {
  console.log(`\n--- ${c.path} (len=${c.value.length}) ---`)
  try {
    const parsed = JSON.parse(c.value)
    console.log(`platform=${parsed.platform} provider=${parsed.provider} method=${parsed.method}`)
    const data = parsed.data
    if (data === undefined) { console.log('(no data)'); continue }
    console.log('data keys:', Object.keys(data))
    console.log('requestedRoot:', JSON.stringify(data.requestedRoot))
    if (Array.isArray(data.trees)) {
      console.log(`trees: ${data.trees.length} root(s)`)
      const print = (node, indent) => {
        const line = '  '.repeat(indent) + `- ${(node.name ?? '?')} [kind=${node.kind ?? '?'}, scope=${node.scope ?? '?'}${node.purpose ? `, purpose=${node.purpose}` : ''}]`
        console.log(line)
        if (Array.isArray(node.children)) for (const ch of node.children) print(ch, indent + 1)
      }
      for (const root of data.trees) print(root, 0)
      if (saved === 0) {
        writeFileSync('D:/1/plan/t25-slot-tree.json', JSON.stringify(parsed, null, 2))
        saved = 1
        console.log('\n>>> full tool result saved to D:/1/plan/t25-slot-tree.json')
      }
    } else {
      console.log('raw data:', JSON.stringify(data).slice(0, 500))
    }
  } catch (e) {
    console.log('parse failed:', e.message, '| head:', c.value.slice(0, 200))
  }
}

if (saved === 0) {
  console.log('\n(no parseable tree found — dumping all "Slots"/"listSubTree" occurrences as raw)')
  const out = []
  function walkRaw (obj) {
    if (typeof obj === 'string') {
      if (obj.includes('Slots') || obj.includes('cordis_inspect_query')) out.push(obj.slice(0, 1000))
    } else if (Array.isArray(obj)) { for (const v of obj) walkRaw(v) }
    else if (obj !== null && typeof obj === 'object') { for (const k of Object.keys(obj)) walkRaw(obj[k]) }
  }
  walkRaw(hist)
  writeFileSync('D:/1/plan/t25-raw-mentions.txt', out.join('\n---\n'))
  console.log(`raw mentions saved -> D:/1/plan/t25-raw-mentions.txt (${out.length} strings)`)
}
