/**
 * @deepseek-ai/dsh-research-app — the dsh Research bundle (T30).
 *
 * The package's runtime content is its `dsh.bundle.patch` document
 * (`cordis.patch.yml`): it overrides the web transport to bind port 1120 and
 * mounts the five dsh-research-* packages over the dsh-web-app layer. This
 * module exports no runtime API of its own; the research behaviour lives in the
 * mounted research packages (dsh-research-cordis, dsh-research-team,
 * dsh-research-web) and the pure libraries they depend on (dsh-research-core,
 * dsh-research-tools).
 * @module @deepseek-ai/dsh-research-app
 */

export {}
