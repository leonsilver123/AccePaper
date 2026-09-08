// @deepseek-ai/dsh-research-tools — T18 roadmap validation (pure).

import type { RoadmapGraph, RoadmapValidation } from './model.ts'

/**
 * Automatic structural check (U4 leg 1): duplicate ids, empty labels, dangling
 * edge refs, self-loops, and directed cycles. (unreachable-from-root and
 * produce-nothing-not-output checks are NOT yet implemented — they require a
 * root/output declaration; tracked as follow-up). Returns errors (never throws
 * on structure — malformed input reports ok:false).
 */
export function validateRoadmap(graph: RoadmapGraph): Readonly<RoadmapValidation> {
  const errors: string[] = []
  const nodeIds = new Set<string>()
  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) errors.push(`duplicate node id '${n.id}'`)
    nodeIds.add(n.id)
    if (typeof n.label !== 'string' || n.label.trim().length === 0) errors.push(`node '${n.id}' has an empty label`)
  }
  for (const e of graph.edges) {
    if (e.from === e.to) errors.push(`self-loop on node '${e.from}'`)
    if (!nodeIds.has(e.from)) errors.push(`edge source '${e.from}' is not a node`)
    if (!nodeIds.has(e.to)) errors.push(`edge target '${e.to}' is not a node`)
  }
  const adj = new Map<string, string[]>()
  for (const n of graph.nodes) adj.set(n.id, [])
  for (const e of graph.edges) adj.get(e.from)?.push(e.to)

  // Directed cycle detection (DFS with colouring).
  const colour = new Map<string, 'w' | 'g' | 'b'>()
  for (const n of graph.nodes) colour.set(n.id, 'w')
  const stack: string[] = []
  const visit = (id: string): void => {
    colour.set(id, 'g')
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const c = colour.get(next) ?? 'w'
      if (c === 'w') visit(next)
      else if (c === 'g') {
        const at = stack.indexOf(next)
        const cycle = [...stack.slice(at), next].join(' → ')
        errors.push(`directed cycle detected: ${cycle}`)
      }
    }
    stack.pop()
    colour.set(id, 'b')
  }
  for (const n of graph.nodes) {
    if ((colour.get(n.id) ?? 'w') === 'w') visit(n.id)
  }
  // Dangling cycle error may have duplicated entries across DFS starts; dedupe.
  return { ok: errors.length === 0, errors: [...new Set(errors)] }
}

/**
 * Kahn topological ordering. Caller must have ok:true (acyclic). Node ids not
 * visited (unreachable) are appended in declaration order (they still render).
 */
export function topoLayers(graph: RoadmapGraph): ReadonlyArray<readonly string[]> {
  const indeg = new Map<string, number>()
  const out = new Map<string, string[]>()
  for (const n of graph.nodes) {
    indeg.set(n.id, 0)
    out.set(n.id, [])
  }
  for (const e of graph.edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    out.get(e.from)?.push(e.to)
  }
  const layers: string[][] = []
  let frontier = graph.nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id)
  let visited = 0
  while (frontier.length > 0) {
    layers.push([...frontier])
    const next: string[] = []
    for (const id of frontier) {
      visited += 1
      for (const to of out.get(id) ?? []) {
        indeg.set(to, (indeg.get(to) ?? 0) - 1)
        if (indeg.get(to) === 0) next.push(to)
      }
    }
    frontier = next
  }
  const remaining = graph.nodes.filter(n => !layers.flat().includes(n.id)).map(n => n.id)
  if (remaining.length > 0) layers.push(remaining) // defensive; validateRoadmap flags cycles upstream
  return layers.map(l => Object.freeze([...l]))
}
