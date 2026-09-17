# Agent Note: The drawing is a seam the deployment fills, and a diagram is a picture

Status: implemented

English | [中文](2026-09-17-the-drawing-is-a-seam-the-deployment-fills.zh.md)

## Problem

Two things were true of every float this pipeline produced. It drew them all with this repository's own SVG/PNG tool — deterministic and dependency-free, which is why it ships, and not a plotting library: its typography, scales and tick placement are a small renderer's, so a paper's figures read as test fixtures. And it drew the chart only: the roadmap travelled as mermaid SOURCE, which LaTeX renders as text and no PDF reader draws, so the compiled document could not carry the diagram at all and the package reported a dropped float instead of a picture. The plan asked for a mature scientific plotting provider; the compile-completeness work had already recorded the missing diagram as the reason the shipped package stays a draft.

## Decision

- **`runner/figure-provider.ts` states the seam** (`FigureProvider`): an id, the library version it asked the machine for, `renderFigure(spec)` and `renderDiagram(graph)`. **Both methods**, because a paper carries both — a provider that drew charts and left the diagram as source is what this repository had. **Both formats from one render** (SVG and base64 PNG), because the HTML manuscript inlines the vector and LaTeX can only carry a raster, so a provider producing one of them loses the figure in half the formats.
- **`dsh-research-cordis/src/matplotlib-provider.ts` is the deployment's provider.** It runs a bundled script through the interpreter the deployment names (a virtual environment's, never the system one), reads both formats back, and **checks the answer**: markup that is not an SVG, bytes that are not a PNG signature, or output that is not result JSON are refused as a provider fault rather than embedded as a figure. The library is **probed** at construction, so a machine without it offers no provider instead of failing at D1 — five steps into a run whose earlier gates had closed.
- **It is configured like the compiler**: `Config.figures` in the cordis plugin, probed in the engine's constructor, read by `ResearchTeamService.hostFigureProvider()` (shape-checked where the deployment-facing value arrives) and handed to `DriveOptions.figureProvider → ExecCtx.figureProvider`. A deployment that names none draws with the built-in renderer.
- **D1 draws the chart and the diagram through whichever provider is configured**, and every float records which library drew it (`drawnBy`, `drawnByVersion`). The diagram float carries its SVG and raster when one drew it, and `diagramDrawn: false` when none did — the honest state rather than a dropped float nobody names.

## Alternatives considered

- **Make the built-in renderer better rather than adding a provider.** Refused: "the figures look like a plotting library's" is a property of a library, and the plan asks for one; improving a small renderer indefinitely is the same work with a worse ceiling.
- **Keep the roadmap as mermaid and rasterise its SVG separately.** Refused twice over: no SVG rasteriser is present on this host (`cairosvg` needs a libcairo DLL that is not installed), and the diagram is a picture either way — the provider draws it directly.
- **Let the provider draw only the chart and fall back to the built-in tool for the diagram.** Refused: it hides which library drew which float, and the diagram is exactly the float the compiled document was losing.
- **Probe the library lazily at D1.** Refused: a deployment whose interpreter cannot draw would then fail five steps into a run whose earlier gates had closed, which is the failure mode the compiler's probe already exists to avoid.

## Consequences

- **Verified against the real library**, not only a stand-in: `dsh-research-cordis/tests/matplotlib-provider.spec.ts` draws a chart and a roadmap with matplotlib 3.11.2 and asserts markup and a PNG signature, and the stand-in tests pin what the provider sends, accepts and refuses. The real-library cases are `describe.skipIf` on an interpreter this host has — the interpreter is found by `DSH_MATPLOTLIB_PYTHON` or a venv path, so a machine without it reports skipped rather than silently passing.
- **The run-level wiring is pinned**: `tests/statement-bindings.spec.ts` drives a run with an injected provider and asserts the floats carry its markup, its id and its version; and a run with none asserts the built-in renderer drew the chart and that `diagramDrawn` is false.
- **What this does not cover.** The provider is not yet in the shipped profile's `cordis.yml`, and no package built here has been drawn with matplotlib — the interpreter lives in this checkout's own venv, which the deployment configuration will have to name for itself. Whether a figure is legible, well-scaled and consistent with the prose is still the visual review's work (M09). The PDF path is unchanged: no LaTeX engine is installed on this host, so `pdf` is still refused as a format this deployment cannot produce.

## Files

- `packages/research/dsh-research-team/src/runner/figure-provider.ts` (new), `runner/registry.ts` (D1 draws through it and records the drawer), `runner/drive.ts`, `runner/types.ts`, `src/index.ts`.
- `packages/research/dsh-research-cordis/src/matplotlib-provider.ts` (new), `src/index.ts` (`Config.figures`, the probe, `figureProvider`).
- Specs: `packages/research/dsh-research-cordis/tests/matplotlib-provider.spec.ts` (new), `packages/research/dsh-research-team/tests/statement-bindings.spec.ts`.
