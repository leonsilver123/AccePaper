// A STAND-IN PDF ENGINE, for the compile path only.
//
// It is NOT a LaTeX engine and typesets nothing: it writes a minimal, structurally-valid PDF where
// pandoc asks for one. What it verifies is this repository's own path — that the PDF branch requests
// a PDF, that pandoc runs an engine, that the bytes come back and are checked for the PDF header, and
// that they survive into the package unchanged. Whether real LaTeX typesets the document is a
// different question, and this fixture cannot answer it.
import { writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const source = process.argv[process.argv.length - 1] ?? ''
const target = join(dirname(source), `${basename(source).replace(/\.tex$/u, '')}.pdf`)
// The marker in the body is what the byte-identity assertion looks for on the other side.
writeFileSync(target, `%PDF-1.4\n% stand-in engine, not LaTeX\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`)
