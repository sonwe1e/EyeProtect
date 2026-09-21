# scripts/legacy

Historical smoke / capture / preview scripts. They are **not** wired into
`package.json` scripts and **not** part of Windows CI
(`.github/workflows/windows.yml`).

Authoritative verification entrypoints live in `scripts/`:

| Script | npm script | CI |
| --- | --- | --- |
| `verify-build-contract.mjs` | `build` (via `verify:build`) | yes |
| `verify-ui-contract.mjs` | `verify:ui-contract` | yes |
| `smoke-simple-experience.mjs` | `smoke:simple` | yes (1 / 1.25 / 1.5 + `--emergency`) |
| `smoke-simple-pet-failure.mjs` | `smoke:pet-failure` | yes |
| `build-app-icon.mjs` | `build:icon` | no (local icon pipeline) |

These legacy scripts target pre-simplify UI or one-off capture flows. They may
depend on packaged-app CDP helpers under `scripts/lib/` and on UI that now
lives under `src/renderer/src/_legacy/`. Run them only for archaeology;
do not treat failures as current product regressions.

Disposition authority: `docs/architecture.md` §遗留面清单.
