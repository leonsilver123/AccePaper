// Independent microsimulation check of the C channel's analytic experiment.
//
// Run from the repository root:
//   node --import tsx/esm packages/research/dsh-research-team/scripts/sumo-validation.mjs
//
// WHY THIS EXISTS. `runner/traffic-sim.ts` measures the two control policies with
// Webster's analytic delay formula. That formula is an approximation, so the 11.09%
// reduction it reports could be an artifact of the approximation rather than a
// property of the two policies. This script re-runs both policies in Eclipse SUMO —
// a microsimulation with a car-following model, queues and stochastic departures —
// and reports what it measures. If SUMO and Webster disagree, the disagreement is
// the result.
//
// This does NOT feed the pipeline. The pipeline must stay deterministic on hosts
// without SUMO installed, so this is recorded evidence produced by a script, not a
// runtime step.
//
// WHAT IS HELD EQUAL. Network, demand, cycle band, lost time and the
// plan-selection rule are the same as the analytic experiment: the flows come from
// the committed study profile, and each interval runs under the plan `selectPlan()`
// picks for that interval's demand (adaptive) or under the plan it picks for the
// design interval (fixed-time).
//
// WHAT IS NOT EQUAL. The analytic model holds demand and cycle constant within an
// interval and evaluates each interval in isolation; SUMO simulates a continuous
// queue. The two also measure different quantities: Webster's stopped-delay
// estimate against SUMO's `timeLoss`. The comparison between POLICIES is
// like-for-like inside each engine; the comparison between ENGINES is indicative.
//
// Reproducibility: fixed `--seed`, zero speed deviation, no teleporting, warm-up
// discarded, and the network and route files regenerated on every run.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  designInterval,
  experimentScenario,
  selectPlan,
} from '../src/runner/traffic-sim.ts'
import { STUDY_DESIGN_INPUTS } from '../src/runner/study-demand.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const OUT_DIR = resolve(PACKAGE_ROOT, '..', '..', '..', '.workbuddy', 'tmp', 'sumo-out')

const SUMO_HOME = process.env.DSH_SUMO_HOME ?? 'H:/tools/sumo/sumo-1.22.0'
const BIN = join(SUMO_HOME, 'bin')
const NETCONVERT = join(BIN, process.platform === 'win32' ? 'netconvert.exe' : 'netconvert')
const SUMO = join(BIN, process.platform === 'win32' ? 'sumo.exe' : 'sumo')

/** Geometry: a symmetric four-leg intersection, one lane per approach. */
const ARM_METERS = 300
/**
 * Yellow per phase. The study declares 8 s of lost time for BOTH phases, so each
 * phase gets half of it: the analytic model's lost time and the microsimulation's
 * intergreen are then the same budget.
 */
const YELLOW_SECONDS = STUDY_DESIGN_INPUTS.lostTimeSeconds / 2
/** Simulated seconds per interval, and how much of the start is discarded as warm-up. */
const SIM_SECONDS = 2400
const WARMUP_SECONDS = 600
/** Split bounds, identical to the analytic experiment's defaults. */
const BOUNDS = { minShare: 0.25, maxShare: 0.75 }

const ARMS = ['north', 'south', 'east', 'west']
/** Phase 1 (major) runs the north-south approaches; phase 2 (minor) the east-west. */
const MAJOR_ARMS = ['north', 'south']
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' }

function xml(path, text) {
  writeFileSync(path, text, 'utf8')
}

function run(command, args, label) {
  try {
    return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  } catch (error) {
    throw new Error(`${label} failed:\n${error?.stdout ?? ''}\n${error?.stderr ?? ''}`)
  }
}

function buildNetworkFiles() {
  const coords = { centre: [0, 0], north: [0, ARM_METERS], south: [0, -ARM_METERS], east: [ARM_METERS, 0], west: [-ARM_METERS, 0] }
  xml(join(OUT_DIR, 'nodes.nod.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<nodes>
${Object.entries(coords).map(([id, [x, y]]) =>
    `  <node id="${id}" x="${x}" y="${y}" type="${id === 'centre' ? 'traffic_light' : 'priority'}"/>`).join('\n')}
</nodes>
`)
  xml(join(OUT_DIR, 'edges.edg.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<edges>
${ARMS.map(arm => `  <edge id="${arm}-in" from="${arm}" to="centre" numLanes="1" speed="13.89"/>`).join('\n')}
${ARMS.map(arm => `  <edge id="${arm}-out" from="centre" to="${OPPOSITE[arm]}" numLanes="1" speed="13.89"/>`).join('\n')}
</edges>
`)
  // Through movements only, one per approach, so the junction has exactly four
  // controlled links and a two-phase structure like the analytic model's.
  xml(join(OUT_DIR, 'connections.con.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<connections>
${ARMS.map(arm => `  <connection from="${arm}-in" to="${OPPOSITE[arm]}-out" fromLane="0" toLane="0"/>`).join('\n')}
</connections>
`)
}

/**
 * Map each controlled link index to the approach it serves.
 *
 * The state string in a `tlLogic` phase is indexed by link index, and the net
 * decides that order — not the order this script writes the arms in. Reading the
 * mapping back out of the generated net keeps the phases correct whatever order
 * netconvert chose.
 */
function linkIndexToArm(netPath) {
  const net = readFileSync(netPath, 'utf8')
  const mapping = []
  const re = /<connection\s+from="([a-z]+)-in"[^>]*to="[a-z]+-out"[^>]*linkIndex="(\d+)"/g
  let match
  while ((match = re.exec(net)) !== null) mapping[Number(match[2])] = match[1]
  return mapping
}

/** A four-phase `static` program: major green, yellow, minor green, yellow. */
function tlLogic(interval, mapping, plan) {
  const effectiveGreen = plan.cycleSeconds - STUDY_DESIGN_INPUTS.lostTimeSeconds
  const majorGreen = effectiveGreen * plan.splitShare
  const minorGreen = effectiveGreen * (1 - plan.splitShare)
  const state = (major, minor) =>
    mapping.map(arm => (MAJOR_ARMS.includes(arm) ? major : minor)).join('')
  return `  <tlLogic id="centre" type="static" programID="interval-${interval}" offset="0">
    <phase duration="${majorGreen.toFixed(2)}" state="${state('G', 'r')}"/>
    <phase duration="${YELLOW_SECONDS}" state="${state('y', 'r')}"/>
    <phase duration="${minorGreen.toFixed(2)}" state="${state('r', 'G')}"/>
    <phase duration="${YELLOW_SECONDS}" state="${state('r', 'y')}"/>
  </tlLogic>`
}

/** Flows for one interval: each phase's demand split evenly over its two approaches. */
function flows(interval, demand) {
  const perArm = [demand[0] / 2, demand[1] / 2]
  return ARMS.map((arm, index) => {
    const vehPerHour = MAJOR_ARMS.includes(arm) ? perArm[0] : perArm[1]
    if (!(vehPerHour > 0)) return ''
    const count = Math.round((vehPerHour * SIM_SECONDS) / 3600)
    if (count <= 0) return ''
    return `  <flow id="f-${interval}-${arm}-${index}" begin="0" end="${SIM_SECONDS}" `
      + `number="${count}" departLane="0" departSpeed="max" `
      + `from="${arm}-in" to="${OPPOSITE[arm]}-out"/>`
  }).filter(Boolean).join('\n')
}

/** Per-vehicle loss from a `tripinfo` file, warm-up discarded. */
function readTripinfo(path, warmupSeconds) {
  const text = readFileSync(path, 'utf8')
  const re = /<tripinfo[^>]*?\bdepart="([0-9.]+)"[^>]*?\btimeLoss="([0-9.]+)"/g
  let match
  const kept = []
  let total = 0
  while ((match = re.exec(text)) !== null) {
    total++
    const depart = Number(match[1])
    if (depart >= warmupSeconds) kept.push(Number(match[2]))
  }
  const mean = kept.length === 0 ? 0 : kept.reduce((sum, value) => sum + value, 0) / kept.length
  return { measured: kept.length, totalTrips: total, meanTimeLossSeconds: mean }
}

function main() {
  const scenario = experimentScenario()
  const design = designInterval(scenario)
  const fixedPlan = selectPlan(scenario, scenario.demandPerPhase[design], BOUNDS)

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  buildNetworkFiles()
  const netPath = join(OUT_DIR, 'net.net.xml')
  run(NETCONVERT, [
    '--node-files', join(OUT_DIR, 'nodes.nod.xml'),
    '--edge-files', join(OUT_DIR, 'edges.edg.xml'),
    '--connection-files', join(OUT_DIR, 'connections.con.xml'),
    '--output-file', netPath,
    '--no-turnarounds', 'true',
  ], 'netconvert')
  const mapping = linkIndexToArm(netPath)
  if (mapping.some(arm => arm === undefined)) {
    throw new Error(`link-to-approach mapping incomplete: ${JSON.stringify(mapping)}`)
  }

  const results = []
  for (let interval = 0; interval < scenario.intervals; interval++) {
    const demand = scenario.demandPerPhase[interval]
    for (const policy of ['fixed-time', 'adaptive']) {
      const plan = policy === 'fixed-time' ? fixedPlan : selectPlan(scenario, demand, BOUNDS)
      const additionalPath = join(OUT_DIR, `tl-${interval}-${policy}.add.xml`)
      const routesPath = join(OUT_DIR, `routes-${interval}-${policy}.rou.xml`)
      const tripinfoPath = join(OUT_DIR, `tripinfo-${interval}-${policy}.xml`)
      xml(additionalPath, `<?xml version="1.0" encoding="UTF-8"?>\n<additional>\n${tlLogic(interval, mapping, plan)}\n</additional>\n`)
      xml(routesPath, `<?xml version="1.0" encoding="UTF-8"?>\n<routes>\n${flows(interval, demand)}\n</routes>\n`)
      run(SUMO, [
        '--net-file', netPath,
        '--route-files', routesPath,
        '--additional-files', additionalPath,
        '--tripinfo-output', tripinfoPath,
        '--begin', '0',
        '--end', String(SIM_SECONDS),
        '--seed', '42',
        '--step-length', '1',
        '--default.speeddev', '0',
        '--time-to-teleport', '-1',
        '--no-step-log', 'true',
        '--duration-log.statistics', 'false',
        '--xml-validation', 'never',
      ], `sumo (interval ${interval}, ${policy})`)
      const parsed = readTripinfo(tripinfoPath, WARMUP_SECONDS)
      results.push({ interval, policy, cycleSeconds: plan.cycleSeconds, splitShare: plan.splitShare, demand, ...parsed })
      console.log(
        `interval ${interval} ${policy.padEnd(10)} demand=[${demand.map(d => d.toFixed(0)).join(',')}] `
        + `cycle=${plan.cycleSeconds.toFixed(1)}s split=${plan.splitShare.toFixed(3)} `
        + `trips=${parsed.measured}/${parsed.totalTrips} meanTimeLoss=${parsed.meanTimeLossSeconds.toFixed(3)}s`,
      )
    }
  }

  const aggregate = {}
  for (const policy of ['fixed-time', 'adaptive']) {
    let weighted = 0
    let weight = 0
    let trips = 0
    for (const row of results.filter(entry => entry.policy === policy)) {
      const total = row.demand[0] + row.demand[1]
      weighted += row.meanTimeLossSeconds * total
      weight += total
      trips += row.measured
    }
    aggregate[policy] = { meanTimeLossSeconds: weight > 0 ? weighted / weight : 0, trips }
  }
  const reductionPct = aggregate['fixed-time'].meanTimeLossSeconds > 0
    ? ((aggregate['fixed-time'].meanTimeLossSeconds - aggregate.adaptive.meanTimeLossSeconds)
      / aggregate['fixed-time'].meanTimeLossSeconds) * 100
    : 0

  console.log('\n=== SUMO microsimulation, demand-weighted ===')
  console.log(`fixed-time ${aggregate['fixed-time'].meanTimeLossSeconds.toFixed(3)} s/veh (${aggregate['fixed-time'].trips} trips)`)
  console.log(`adaptive   ${aggregate.adaptive.meanTimeLossSeconds.toFixed(3)} s/veh (${aggregate.adaptive.trips} trips)`)
  console.log(`reduction  ${reductionPct.toFixed(3)} %`)

  const report = {
    sumoVersion: run(SUMO, ['--version'], 'sumo --version').split('\n')[0].trim(),
    network: 'four-leg, one lane per arm, through movements only, arms 300 m, limit 13.89 m/s',
    seed: 42,
    simSeconds: SIM_SECONDS,
    warmupSeconds: WARMUP_SECONDS,
    bounds: BOUNDS,
    fixedPlan,
    aggregate,
    reductionPct,
    intervals: results,
  }
  writeFileSync(join(OUT_DIR, 'sumo-validation.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(`\nwrote ${join(OUT_DIR, 'sumo-validation.json')}`)
}

main()
