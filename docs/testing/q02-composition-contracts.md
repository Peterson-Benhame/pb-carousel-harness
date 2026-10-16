# Q02 — Composition contracts and candidate layouts

> Cópia pública sanitizada: registros privados de conversa e execução foram omitidos. Estados e resultados técnicos abaixo descrevem a etapa original, não uma certificação da versão atual.

Date: 2026-10-16 (UTC). Base: `8c2c2c65e7c9db96519434d294564cb972f02dd8`.
Scope: Q02 only, following accepted Q01/G1 contracts. Existing uncommitted planning
and architecture documents were preserved. No commit or publication was made by
this executor; a coordinator commit is recorded separately in Git.

## Implemented

- Pure `validateCompositionPlan` with strict canonical JSON, exact nested keys,
  immutable output, scoped asset descriptors, exact qualification/definition hashes,
  region/style relationships, UTF-16 and grapheme-safe reconstruction, complete
  ordered coverage and explicit rejection of unsupported nonempty code/number.
- Deterministic `derivePreviewSelection` over declared risks, including density,
  representative grouping, diagrams, risky seams and the six-slide maximum.
- Pure `validateLayoutQualification`, closed JSON schema and exactly five candidate
  definitions: cover, flow, dense, diagram and CTA. Fixed geometry/limits and exact
  font bindings are data, not code templates. No record is released.
- `assertQualifiedLayout` fails closed because there is no trusted released catalog.
  A caller-provided `status:'qualified'` or complete-looking release JSON cannot
  authorize production.
- Limited brand configuration v2: optional exact Nimbus ID and explicit surface
  bindings to tokens in the same palette. Historical configuration v1 is unchanged;
  no accent, identity, personal content or palette is inserted by default.
- Resource manifest v2 separately identifies legacy and candidate composed renderer
  files/hashes. The historical v1 reader and default effective legacy renderer
  identity remain compatible. Candidate-only missing resources do not block the
  unrelated legacy path. Composed modules/checkers still absent are reported as
  incomplete; altered declared bytes produce mismatch.
- Read-only optional Nimbus diagnostics under the explicitly authorized font root:
  missing/mismatch is separate from product-use authorization and license status.
  The product use remains blocked and no usable Nimbus path is returned. Baseline
  calls never search for or require the unused optional font.
- A small compatibility barrier in the v1 snapshot constructor: brand config v2 or a composed renderer identity
  yields `RUN_CONTRACT_UNSUPPORTED` until Q04 implements snapshot/pipeline v2.
  Creation and derivation cannot write a structurally invalid v1 snapshot;
  historical snapshots and brand revisions are preserved.

## Exact scope and unresolved work

These are structural contracts, not a compositor, trusted preflight or production
service. They do not prove that a long word or dense body fits with real glyphs;
they do not inspect pixels, contrast, collisions or editorial quality. Declared
asset geometry and measured risk bounds are checked for consistency but are not
independently measured here. Real measurements and visual qualification belong to
Q03/Q06, after T18/T19.

The pure validator cannot resolve carousel/concept artifact bytes or recompute
`copyFingerprint` without the service's executable/snapshot context. It checks the
reference shape, supplied canonical copy reconstruction, scoped resolved asset
descriptors and supplied qualification records. Persistence must recheck those
refs, bytes, hashes, scope, snapshot and authority. Q04/Q05 are not implemented.

Candidate `checkerRef`/`rubricRef` nulls explicitly represent absent Q06 resources.
Only candidates allow null. Replacing nulls changes the definition hash, requires a
successor version and new evidence over the final definition; old evidence cannot
be recycled. Qualified/rejected structures require pinned refs. No checker hash is
invented for a nonexistent module.

The five candidates currently offer no decoration choice, overlap pair or
continuity anchor; their allowlists are empty. The maximum of two overlaps is only
a limit. Synthetic candidates test the positive continuity relation without
expanding or releasing the packaged catalog. No fallback, font substitution,
Nimbus download, installation, transfer, embedding or distribution occurred.

No SQL migration, snapshot v2, stage graph, approval service, rendering service,
public CLI command, package release or plugin integration was added. The v1 guard
is a compatibility boundary, not Q04 implementation. No real user workspace was
migrated or mutated by tests.

## Changed files

Production and declarative resources:

- `src/domain/composition-plan.mjs`
- `src/domain/layout-qualification.mjs`
- `src/domain/brand-schema.mjs`
- `src/domain/run-snapshot.mjs` (v1 refusal boundary only)
- `src/infrastructure/resources.mjs`
- `src/application/doctor.mjs`
- `shared/composition-plan.schema.json`
- `shared/layout-qualification.schema.json`
- `shared/layouts/editorial-composed-v1.json`
- `shared/resources.manifest.json`

Tests and documentation:

- `tests/unit/composition-plan.test.mjs`
- `tests/unit/layout-qualification.test.mjs`
- `tests/unit/brand-schema.test.mjs`
- `tests/integration/doctor.test.mjs`
- `tests/integration/run-snapshot.test.mjs`
- `tests/fixtures/quality/composition-fixture.mjs`
- `tests/fixtures/quality/README.md`
- This report

## Verification

Executed environment: cloud Linux x64, Node v24.19.0. This differs from the
existing qualified Windows runtime (Node v24.21.0); the real doctor reports that
mismatch. Synthetic test matrices exercise diagnostic branches without claiming
runtime or font qualification.

TDD evidence:

1. Composition tests failed first because the required API was absent (13 initial
   cases, expanded to 18 before implementation). First implementation green: 18/18.
2. Layout tests failed before the domain module/catalog/schema existed. Resource
   and brand v2 tests failed against the baseline implementation while historical
   tests stayed green.
3. Further red→green cycles covered empty semantic diagram regions, artifact ID
   aliasing, null collection elements, reserved block identities, Nimbus diagnostic
   availability versus authorization, and mandatory legacy fonts despite a subset.
4. The new v1 snapshot test reproduced both create and derive accepting config v2;
   the guard then made both fail with `RUN_CONTRACT_UNSUPPORTED`, without writing
   runs/operation results or changing historical snapshots.

Commands actually executed include:

    node --test tests/unit/composition-plan.test.mjs
    node --test tests/unit/layout-qualification.test.mjs
    node --test tests/unit/brand-schema.test.mjs tests/integration/doctor.test.mjs tests/integration/brand-memory.test.mjs
    node --test tests/integration/run-snapshot.test.mjs tests/integration/run-inputs.test.mjs tests/integration/run-runtime.test.mjs
    node --test --test-reporter=tap
    npm test
    git diff --check

Initial full regression: 342/342 passed, zero skips/failures, before the final review
hardening tests. Final totals are recorded below after the frozen-source rerun.
Schemas were also checked with already-installed Python `jsonschema` 4.26.0
Draft202012Validator: both schemas valid; both plan fixtures and all five candidate
records accepted. Independent review checked additional nested-key rejection cases.
No test dependency was installed.

Final frozen-source verification:

- `npm test`: **375/375 passed**, zero failures, skips or cancellations. The
  coordinator independently reconfirmed **375/375** in **8205.222109 ms**.
- Focused composition: **26/26**; layout qualification: **72/72**.
- Focused brand/doctor/brand-memory: **55/55**; the final v1 snapshot suite: **17/17**.
- Combined Windows-targeted contract suite: **159/159** on this cloud environment.
- `git diff --check`: clean. Declared Q02 file hashes were refreshed and checked.
- Independent frozen-source review: `node --test` **375/375**, 172 nested extra-key mutations rejected, both schemas checked, and all 17 declared renderer hashes verified (3 legacy + 14 composed-contract/transitive files).
- npm printed an informational newer-version notice; no update/install was run.

The final review added an exact v1 renderer-identity barrier and normalizes only
semantic sets (asset refs/placements, anchor IDs, overlaps, decoration choices,
continuities and reason-code sets). Copy blocks and spans retain reading order.
Reason codes use the fixed version-1 enum order, not host locale collation.
