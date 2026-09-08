// @deepseek-ai/dsh-research-tools — T18 roadmap renderers (pure, deterministic).

import type { RoadmapGraph } from './model.ts'
import { topoLayers } from './validate.ts'

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeMermaid(s: string): string {
  return s.replaceAll('"', "'").replace(/[\[\]{}|]/g, ' ')
}

/** Render as Mermaid flowchart source (preview / degradation-friendly). */
export function renderMermaid(graph: RoadmapGraph, title?: string): string {
  const lines: string[] = ['flowchart LR']
  if (title !== undefined && title.trim().length > 0) lines.push(`  %% ${escapeMermaid(title)}`)
  const clean = new Map<string, string>()
  for (const n of graph.nodes) clean.set(n.id, `n${n.id.replace(/\W/g, '')}`)
  const seen = new Set<string>()
  for (const n of graph.nodes) {
    let safe = clean.get(n.id) ?? `n${seen.size}`
    while (seen.has(safe)) safe = `${safe}_`
    seen.add(safe)
    clean.set(n.id, safe)
  }
  for (const n of graph.nodes) {
    lines.push(`  ${clean.get(n.id)}["${escapeMermaid(n.label)}"]`)
  }
  for (const e of graph.edges) {
    const label = e.label === undefined ? '' : `|${escapeMermaid(e.label)}|`
    lines.push(`  ${clean.get(e.from)}${label}--> ${clean.get(e.to)}`)
  }
  return lines.join('\n')
}

const NODE_W = 170
const NODE_H = 46
const GAP_X = 90
const GAP_Y = 66

/** Render a layered SVG (deterministic; no file writes, no randomness). */
export function renderSvg(graph: RoadmapGraph): string {
  const layers = topoLayers(graph)
  const labelById = new Map(graph.nodes.map(n => [n.id, n.label]))
  const layerWidths: number[] = []
  layers.forEach((layer, li) => {
    layer.forEach((_id, ii) => {
      layerWidths[li] = Math.max(layerWidths[li] ?? 0, ii + 1)
    })
  })
  const totalW = layers.reduce((acc, _l, li) => acc + (layerWidths[li] ?? 1) * (NODE_W + GAP_X), 0) - GAP_X + 40
  const totalH = Math.max(...layerWidths.map(w => w ?? 1), 1) * (NODE_H + GAP_Y) + 20
  const px = new Map<string, { x: number; y: number }>()
  layers.forEach((layer, li) => {
    layer.forEach((id, ii) => {
      const c = layerWidths[li] ?? 1
      const colStart = layers.slice(0, li).reduce((a, _l, k) => a + (layerWidths[k] ?? 1) * (NODE_W + GAP_X), 0) + 20
      const span = c * (NODE_W + GAP_X) - GAP_X
      const x = colStart + (span - NODE_W) / 2 + ii * (NODE_W + GAP_X)
      const y = 20 + ii * (NODE_H + GAP_Y)
      px.set(id, { x, y })
    })
  })
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`]
  for (const e of graph.edges) {
    const a = px.get(e.from)
    const b = px.get(e.to)
    if (!a || !b) continue
    const x1 = a.x + NODE_W
    const y1 = a.y + NODE_H / 2
    const x2 = b.x
    const y2 = b.y + NODE_H / 2
    const mid = (x1 + x2) / 2
    parts.push(`<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="#185FA5" stroke-width="1.5"/>`)
    parts.push(`<polygon points="${x2},${y2} ${x2 - 8},${y2 - 4} ${x2 - 8},${y2 + 4}" fill="#185FA5"/>`)
  }
  for (const n of graph.nodes) {
    const p = px.get(n.id)
    if (!p) continue
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="#E6F1FB" stroke="#185FA5" stroke-width="1"/>`)
    const label = (labelById.get(n.id) ?? n.id).slice(0, 26)
    parts.push(`<text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#042C53">${escapeXml(label)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('\n')
}
