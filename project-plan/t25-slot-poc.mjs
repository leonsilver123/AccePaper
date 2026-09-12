// T25 real Client Boot PoC — capture the REAL client Slots tree.
// Self-contained: spawns `dsh web` (cwd=workspace, --patch pin-browse-picker,
// --port <free>, mock LLM env) + drives a real Edge page (channel:'msedge',
// headless) + RPC (session/create cordis + session/prompt) + polls session/page
// for the cordis_inspect_query tool/result.
//
// Run (mock:llm must already be running on :8000):
//   NODE_PATH=D:/1/deepseek-harness-master1/deepseek-harness-master/apps/web/node_modules \
//     node D:/1/plan/t25-slot-poc.mjs
//
// Requires (all pre-verified): apps/web/dist built; tsx resolvable from repo
// package.json; msedge at Program Files (x86)\Microsoft\Edge; playwright+ws
// linked under apps/web/node_modules (NODE_PATH resolves both).
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const REPO = 'D:/1/deepseek-harness-master1/deepseek-harness-master'
const MOCK_BASE = 'http://127.0.0.1:8000'
const OUT_TREE = 'D:/1/plan/t25-slot-tree-evidence.json'
const OUT_LOG = 'D:/1/plan/t25-slot-poc.log'
const PICKER_PATCH = join(REPO, 'apps/web/tests/pin-browse-picker.overlay.yml')

const log = (m) => console.log(`[t25] ${m}`)

function probeFreePort () {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('port probe returned no address')))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

function waitForReadyLine (child) {
  return new Promise((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => {
      reject(new Error(`dsh web not ready in 90s; output:\n${out}`))
    }, 90_000)
    const onData = (chunk) => {
      out += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(out)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited early (code ${code}); output:\n${out}`))
    })
  })
}

async function authenticatedWeb (url) {
  const response = await fetch(url, { redirect: 'manual' })
  const setCookie = response.headers.get('set-cookie')
  if (response.status !== 303 || setCookie === null) {
    throw new Error(`dsh web authentication returned HTTP ${String(response.status)}`)
  }
  return { origin: new URL(url).origin, cookie: setCookie.split(';', 1)[0] }
}

async function rpc (origin, cookie, endpoint, args) {
  const response = await fetch(`${origin}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `t25-${endpoint}-${randomUUID()}`,
      method: endpoint,
      payload: { args },
    }),
  })
  if (!response.ok) {
    throw new Error(`${endpoint} HTTP ${response.status}: ${await response.text()}`)
  }
  const body = await response.json()
  if (!body.result.ok) {
    throw new Error(`${endpoint} failed: ${body.result.error.code}: ${body.result.error.message}`)
  }
  return body.result.value
}

function newEnglishPage (browser) {
  return browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
}

async function connectFreshWorkspace (page, root, name = 'workspace') {
  mkdirSync(join(root, name), { recursive: true })
  await page.getByRole('textbox', { name: 'Choose workspace' }).click({ force: true })
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.waitFor({ timeout: 20_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, name))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator(
    '[data-composer-input][contenteditable="true"][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]',
  ).waitFor({ timeout: 15_000 })
}

// Read session history via the session/page HTTP RPC (no WebSocket needed).
// session/page rejects throughSeq > latest cursor ("past cursor N"); parse N
// from the error and retry with the valid (≤ cursor) cut.
async function history (origin, cookie, sessionId) {
  const tryPage = (throughSeq) => rpc(origin, cookie, 'session/page', {
    request: { address: { kind: 'session', sessionId }, throughSeq, maxMessages: 500 },
  })
  try {
    return await tryPage(Number.MAX_SAFE_INTEGER)
  } catch (e) {
    const m = /past cursor (\d+)/.exec(e.message)
    if (!m) throw e
    return await tryPage(Number(m[1]))
  }
}

async function main () {
  if (!existsSync(join(REPO, 'apps/web/dist/index.html'))) {
    throw new Error('apps/web/dist not built — run pnpm run build first')
  }
  if (!existsSync(PICKER_PATCH)) throw new Error(`picker patch missing: ${PICKER_PATCH}`)

  const wsDir = mkdtempSync(join(tmpdir(), 'dsh-t25-ws-'))
  mkdirSync(join(wsDir, '.git'), { recursive: true })
  writeFileSync(join(wsDir, 'AGENTS.md'), 'T25 PoC workspace\n')
  log(`workspace(cwd)=${wsDir}`)

  const tsxLoader = pathToFileURL(createRequire(join(REPO, 'package.json')).resolve('tsx')).href
  log(`tsxLoader=${tsxLoader}`)

  const port = await probeFreePort()
  log(`free port=${port}`)

  const child = spawn(
    process.execPath,
    ['--import', tsxLoader, join(REPO, 'apps/cli/src/bin.ts'), 'web', '--patch', PICKER_PATCH, '--no-open', '--port', String(port)],
    {
      cwd: wsDir,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'sk-xxx-placeholder',
        DEEPSEEK_BASE_URL: MOCK_BASE,
        DSH_HOME: join(wsDir, '.dsh'),
        DSH_AGENTS_HOME: join(wsDir, '.agents'),
        TSX_TSCONFIG_PATH: join(REPO, 'tsconfig.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', (c) => process.stdout.write(`[web] ${c}`))
  child.stderr.on('data', (c) => process.stderr.write(`[web!] ${c}`))

  let browser
  try {
    const baseUrl = await waitForReadyLine(child)
    log(`baseUrl=${baseUrl}`)
    const { origin, cookie } = await authenticatedWeb(baseUrl)
    log(`auth OK origin=${origin}`)

    browser = await chromium.launch({ channel: 'msedge', headless: true })
    const page = await newEnglishPage(browser)
    page.on('pageerror', (e) => log(`PAGEERROR: ${e}`))
    await page.goto(baseUrl, { waitUntil: 'load' })
    log('page loaded')
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    try { await page.screenshot({ path: 'D:/1/plan/t25-page-01.png', fullPage: true }) } catch { /* best-effort */ }
    try { writeFileSync('D:/1/plan/t25-pagetext-01.txt', await page.evaluate(() => document.body.innerText)) } catch { /* best-effort */ }
    log('frame ready; screenshot+innerText -> t25-page-01.png / t25-pagetext-01.txt')
    await new Promise((r) => setTimeout(r, 2500))

    // Dismiss the "Internal Testing Notice" modal (blocks all clicks until Continue).
    try {
      const cont = page.getByRole('button', { name: 'Continue', exact: true })
      await cont.waitFor({ state: 'visible', timeout: 10_000 })
      await cont.click()
      log('dismissed Internal Testing Notice')
      await new Promise((r) => setTimeout(r, 1500))
    } catch (e) {
      log(`(no testing notice to dismiss: ${e.message})`)
    }

    try {
      await connectFreshWorkspace(page, wsDir)
    } catch (e) {
      try { await page.screenshot({ path: 'D:/1/plan/t25-page-connect-fail.png', fullPage: true }) } catch { /* best-effort */ }
      try { writeFileSync('D:/1/plan/t25-page-dom.html', await page.content()) } catch { /* best-effort */ }
      try { writeFileSync('D:/1/plan/t25-pagetext-connect-fail.txt', await page.evaluate(() => document.body.innerText)) } catch { /* best-effort */ }
      throw e
    }
    log('workspace connected — default conversation view rendered (client Slots provider now LIVE)')

    const created = await rpc(origin, cookie, 'session/create', { request: { agentPreset: 'cordis' } })
    const sid = created.sessionId
    log(`cordis session=${sid} preset=${created.agentPreset ?? '?'}`)
    try {
      await rpc(origin, cookie, 'session/rename', { request: { sessionId: sid, title: 'T25-Cordis-SlotTree' } })
    } catch (e) {
      log(`rename skipped: ${e.message}`)
    }

    await rpc(origin, cookie, 'session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId: sid,
        mode: 'queue',
        content: [{ type: 'text', text: 'Inspect the client Slots tree via cordis_inspect_query (platform client, provider Slots, method listSubTree).' }],
      },
    })
    log('prompt sent — mock:llm emits cordis_inspect_query tool_call; polling session/page for tool/result...')

    let raw = null
    let attempts = 0
    const t0 = Date.now()
    while (Date.now() - t0 < 120_000) {
      await new Promise((r) => setTimeout(r, 2500))
      let pageData
      try {
        pageData = await history(origin, cookie, sid)
      } catch (e) {
        log(`history poll err: ${e.message}`)
        continue
      }
      const json = JSON.stringify(pageData)
      attempts += 1
      const hit = json.includes('"Slots"') || json.includes('listSubTree') || json.includes('cordis_inspect_query')
      if (hit) {
        log(`HIT on poll #${attempts} (${Math.round((Date.now() - t0) / 1000)}s) — capturing`)
        raw = json
        break
      }
      if (attempts % 4 === 0) log(`poll #${attempts} no hit (${Math.round((Date.now() - t0) / 1000)}s)`)
    }

    if (raw === null) throw new Error('timeout: cordis_inspect_query tool/result not observed in session/page within 120s')

    writeFileSync(OUT_LOG, raw)
    log(`raw history saved -> ${OUT_LOG} (${raw.length} bytes)`)

    // Extract the tool-result payload (tool-cordis renders JSON.stringify({platform,provider,method,data})).
    let extracted = null
    try {
      const parsed = JSON.parse(raw)
      const records = parsed.records ?? []
      for (const record of records) {
        const ev = record.event ?? record
        const evJson = JSON.stringify(ev)
        const idx = evJson.indexOf('"provider":"Slots"')
        if (idx >= 0) {
          let start = evJson.lastIndexOf('{', idx)
          if (start < 0) start = 0
          extracted = evJson.slice(start, idx + 4000)
          break
        }
      }
    } catch (e) {
      log(`extract err: ${e.message}`)
    }

    console.log('\n===== T25 REAL CLIENT SLOT TREE EVIDENCE =====')
    console.log(`sessionId=${sid}`)
    if (extracted !== null) {
      console.log('--- extracted cordis_inspect_query result segment ---')
      console.log(extracted)
    } else {
      console.log('(inline extraction failed — full history in OUT_LOG)')
    }
    console.log(`\n(full history JSON: ${raw.length} bytes -> ${OUT_LOG})`)
    console.log('===== END =====')

    writeFileSync(OUT_TREE, JSON.stringify({
      sessionId: sid,
      capturedAt: 'T25-PoC',
      rawHistoryLength: raw.length,
      extracted,
      fullHistory: JSON.parse(raw),
    }, null, 2))
    log(`evidence saved -> ${OUT_TREE}`)
  } finally {
    await browser?.close().catch(() => {})
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e.stack ?? e.message)
  process.exit(1)
})
