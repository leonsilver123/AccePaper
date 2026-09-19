/**
 * One attachment's own bytes: the file, read at one version or refused.
 *
 * THE THREE FACTS THAT MUST NOT ARRIVE AS ONE VALUE are "this deployment does not read files at
 * all", "the file could not be read", and "the file moved while it was being read". Each has its own
 * refusal below, because a file that was never asked for, a file this machine no longer holds, and a
 * file that was replaced are three different reasons for a reader to stop, and a package built on any
 * of them looks the same afterwards.
 *
 * WHERE THE BYTES COME FROM IS MEASURED. `GET …/items/<attachmentKey>/file` answered `302` with a
 * `Location: file:///…/storage/<key>/<name>.pdf` and an empty body against Zotero 9.0.6 on
 * 2026-09-19, and following that redirect is refused by Node's own HTTP layer ("URL scheme must be a
 * HTTP(S) scheme"); the cases here replay that pointer shape, and the file behind it is a real file
 * in a temporary directory. TWO SHAPES COULD NOT BE MEASURED on this library and are marked where
 * they are used: a response that carries the bytes instead of pointing at them, and a location on
 * another host.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { resolveAttachmentPolicy, ZoteroProvider } from '../src/zotero-provider.ts'
import type { FetchLike, ZoteroProviderConfig } from '../src/zotero-provider.ts'

/** The item and the attachment the live library holds, and the versions the live read measured. */
const ITEM = 'UA5MIGG3'
const ATTACHMENT = 'PU2XWW83'

/** A scratch directory for the files the pointer cases read; removed when this file finishes. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'dsh-zotero-attachment-'))
afterAll(() => { rmSync(SCRATCH, { recursive: true, force: true }) })

/**
 * The bytes of the file these cases read.
 *
 * A PDF'S OWN HEADER AND NOTHING THE PROVIDER PARSES: this capability hands the file on as it is, so
 * the content the cases use only has to be bytes a reader could tell apart from other bytes.
 */
const FILE_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1')

/** One attachment of the item, as the children endpoint lists it. */
function listing(version: number, data: Record<string, unknown> = {}): unknown {
  return {
    key: ATTACHMENT,
    version,
    data: {
      itemType: 'attachment',
      contentType: 'application/pdf',
      filename: 'roche-2020.pdf',
      ...data,
    },
  }
}

/** A response carrying a JSON body, as the listing route answers. */
function jsonResponse(body: string): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

/** A response carrying a status and no body, as a route that will not serve the file answers. */
function statusResponse(status: number): Awaited<ReturnType<FetchLike>> {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

/** The file route's answer, as measured 2026-09-19: a location instead of the file. */
function pointer(location: string): Awaited<ReturnType<FetchLike>> {
  return {
    ok: false,
    status: 302,
    headers: { get: name => (name.toLowerCase() === 'location' ? location : null) },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

/**
 * A response carrying the file itself.
 *
 * NOT A MEASURED SHAPE: this library answers the pointer above, and this case holds the other answer
 * a library may give so that the branch which reads a body is not unexercised code.
 *
 * @param bytes - the body the response carries.
 * @returns the response.
 */
function streamed(bytes: Uint8Array): Awaited<ReturnType<FetchLike>> {
  const body = Uint8Array.from(bytes)
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    arrayBuffer: () => Promise.resolve(body.buffer),
  }
}

/**
 * What one route of the stand-in answers.
 *
 * A REJECTION IS PART OF THE TYPE because an endpoint that stopped answering is a case these reads
 * must report as an outage, and that arrives as a rejected request rather than as a response.
 */
type RouteAnswer = Awaited<ReturnType<FetchLike>> | Promise<never>

/**
 * A `fetch` answering the two routes this read uses, with the bodies a case dictates.
 *
 * THE LISTING IS A FUNCTION because the whole point of the version check is that the SAME list, read
 * twice, can report two versions; a fixed body could not express that case at all.
 *
 * @param options - the listing, the file route's answer, and where the requests are recorded.
 * @returns the fetch function.
 */
function attachmentFetch(options: {
  readonly children: () => unknown
  readonly file: () => RouteAnswer
  readonly requests: string[]
}): FetchLike {
  return (url, init) => {
    // THE REDIRECT MODE IS RECORDED WITH THE URL: the file route must be read with its redirect
    // visible, and a caller that dropped the init would look identical from the URL alone.
    options.requests.push(`${init.redirect ?? 'follow'} ${url}`)
    if ((url.split('?')[0] ?? '').endsWith('/children')) {
      return Promise.resolve(jsonResponse(JSON.stringify(options.children())))
    }
    return Promise.resolve(options.file())
  }
}

/** A provider over that fetch, with the attachment policy a case names. */
function providerOver(options: {
  readonly children: () => unknown
  readonly file: () => RouteAnswer
  readonly requests: string[]
  readonly attachments?: 'none' | 'local-cache'
}): ZoteroProvider {
  return new ZoteroProvider({
    apiBase: 'http://127.0.0.1:23119/api',
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
  }, attachmentFetch(options), { get: () => undefined })
}

/** A provider config as `cordis.yml` hands one over: untyped, so the value is never checked first. */
function declared(values: Record<string, unknown>): ZoteroProviderConfig {
  return {
    apiBase: 'http://127.0.0.1:23119/api',
    localLibraryPath: 'users/0',
    mcpServerName: 'zotero',
    ...values,
  }
}

describe('reading one attachment\'s file, once the deployment enabled it', () => {
  it('reads the file the attachment names, and hashes the bytes it returned', async () => {
    const file = join(SCRATCH, 'roche-2020.pdf')
    writeFileSync(file, FILE_BYTES)
    const requests: string[] = []
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => pointer(pathToFileURL(file).href),
      requests,
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Buffer.from(read.file.bytes).equals(readFileSync(file))).toBe(true)
    expect(read.file.size).toBe(FILE_BYTES.byteLength)
    // THE HASH IS OVER THE FILE THIS MACHINE HOLDS, checked here against bytes read off the disk by a
    // route the provider does not use: a hash over anything the module assembled would still agree
    // with itself.
    expect(read.file.sha256).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'))
    expect(read.file.attachment).toEqual({
      key: ATTACHMENT, version: 2690, filename: 'roche-2020.pdf', contentType: 'application/pdf',
    })
    // THE RECORD IS READ TWICE, which is what makes the version a fact about the file rather than
    // about the moment the listing happened; the file itself is asked for once, with its redirect
    // visible, over the route the live library measured.
    expect(requests.filter(url => url.includes('/children'))).toHaveLength(2)
    expect(requests.filter(url => url.endsWith('/file'))).toEqual([
      `manual http://127.0.0.1:23119/api/users/0/items/${ATTACHMENT}/file`,
    ])
  })

  it('refuses a file that moved between the listing and the bytes', async () => {
    // THE CASE THIS READ EXISTS FOR. The bytes are real and the pointer is real; what is not real is
    // calling them the file a passage of this source was read from.
    const file = join(SCRATCH, 'replaced.pdf')
    writeFileSync(file, FILE_BYTES)
    const requests: string[] = []
    let listingCount = 0
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => {
        listingCount += 1
        return [listing(listingCount === 1 ? 2690 : 2691)]
      },
      file: () => pointer(pathToFileURL(file).href),
      requests,
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('version-moved')
    expect(read.failure.detail).toContain('2690')
    expect(read.failure.detail).toContain('2691')
    // THE REFUSAL COMES AFTER THE FILE WAS READ, not instead of reading it: a file that moved is only
    // detectable once the two listings disagree.
    expect(requests.some(url => url.endsWith('/file'))).toBe(true)
  })

  it('refuses an attachment that is not a PDF, without asking for its file', async () => {
    const requests: string[] = []
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690, { contentType: 'text/html', filename: 'snapshot.html' })],
      file: () => statusResponse(200),
      requests,
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-unreadable')
    // NAMED AS ITSELF: "no such attachment" would send a reader looking for a key that is there.
    expect(read.failure.detail).toContain('text/html')
    expect(requests.some(url => url.endsWith('/file'))).toBe(false)
  })

  it('refuses a key the item does not hold, and says which ones it does', async () => {
    const requests: string[] = []
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => statusResponse(200),
      requests,
    }).readAttachment(ITEM, 'ABCD1234')

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-unreadable')
    expect(read.failure.detail).toContain('ABCD1234')
    expect(read.failure.detail).toContain(ATTACHMENT)
    expect(requests.some(url => url.endsWith('/file'))).toBe(false)
  })

  it('uses the bytes when the library answers with them rather than with a location', async () => {
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => streamed(FILE_BYTES),
      requests: [],
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(Buffer.from(read.file.bytes).equals(FILE_BYTES)).toBe(true)
    expect(read.file.sha256).toBe(createHash('sha256').update(FILE_BYTES).digest('hex'))
    expect(read.file.size).toBe(FILE_BYTES.byteLength)
  })

  it('refuses a location that is not a file on this machine', async () => {
    // NOT A MEASURED SHAPE: what this library answers is a local file. The refusal is what keeps the
    // read local for the same reason the endpoint is a deployment setting.
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => pointer('https://example.org/roche-2020.pdf'),
      requests: [],
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-unreadable')
    expect(read.failure.detail).toContain('https')
  })

  it('refuses a file this machine no longer holds, without naming where it keeps it', async () => {
    const gone = join(SCRATCH, 'gone.pdf')
    rmSync(gone, { force: true })
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => pointer(pathToFileURL(gone).href),
      requests: [],
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-unreadable')
    expect(read.failure.detail).toContain('ENOENT')
    // A FAILURE SENTENCE TRAVELS into records a run's package may carry; where this disk keeps the
    // file is not part of what a reader of that record needs.
    expect(read.failure.detail).not.toContain(gone)
  })

  it('refuses a file route that answers a status and no location', async () => {
    // MEASURED: a key the library does not hold answers `404` on this route.
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => statusResponse(404),
      requests: [],
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-unreadable')
    expect(read.failure.detail).toContain('404')
  })

  it('reports an endpoint that stopped answering as an outage, not as an attachment', async () => {
    const read = await providerOver({
      attachments: 'local-cache',
      children: () => [listing(2690)],
      file: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:23119')),
      requests: [],
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('endpoint-unreadable')
    expect(read.failure.detail).toContain('ECONNREFUSED')
  })
})

describe('the capability is the deployment\'s, and nothing else changes it', () => {
  it('reads nothing, and requests nothing, when no policy is declared', async () => {
    const requests: string[] = []
    const read = await providerOver({
      children: () => [listing(2690)],
      file: () => pointer(pathToFileURL(join(SCRATCH, 'roche-2020.pdf')).href),
      requests,
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-disabled')
    // NOT ONE REQUEST: an undeclared deployment behaves exactly as it did before this existed, and a
    // caller cannot reach a file by naming one.
    expect(requests).toEqual([])
  })

  it('reads nothing when the deployment states `none` as well', async () => {
    const requests: string[] = []
    const read = await providerOver({
      attachments: 'none',
      children: () => [listing(2690)],
      file: () => statusResponse(200),
      requests,
    }).readAttachment(ITEM, ATTACHMENT)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.code).toBe('attachment-disabled')
    expect(requests).toEqual([])
  })

  it('fails the load when the declared policy names nothing', () => {
    expect(resolveAttachmentPolicy(undefined)).toBe('none')
    expect(resolveAttachmentPolicy('local-cache')).toBe('local-cache')
    expect(() => resolveAttachmentPolicy('localcache')).toThrow(/`attachments` must be one of none \| local-cache/u)
    // AND THE PROVIDER IS WHERE IT IS CHECKED, because that is where the value enters: a deployment
    // that misspelt the field is stopped at load rather than running under a policy it did not name.
    expect(() => new ZoteroProvider(
      declared({ attachments: 'localcache' }),
      attachmentFetch({ children: () => [], file: () => statusResponse(200), requests: [] }),
      { get: () => undefined },
    )).toThrow(/localcache/u)
  })
})
