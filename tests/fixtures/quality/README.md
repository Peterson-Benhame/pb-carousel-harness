# Q02 synthetic composition contracts

These fixtures exercise declarative contracts. They are not visual qualification,
production approvals, copies of a customer carousel or evidence of a font license.

## Contents

- `composition-fixture.mjs` creates a small canonical carousel, a corresponding
  plan and candidate qualification records from the package catalog. Every name,
  string, identifier and asset is synthetic. The configurable slide-count exception
  exists only to keep contract tests small.
- Asset descriptors have the exact shape
  `{brandId, runId, assetKey, artifactRef, metadata}`. Metadata is
  `{width, height, semantic, anchors, minLabelSize, minInformativeStroke}`;
  each anchor is `{id, x, y}` in normalized `[0,1]` coordinates. There are no paths
  or font bytes in these descriptors. The managed artifact resolver must supply
  verified bytes and scope in the future production service.
- Artifact hashes in the fixture are synthetic placeholders. Qualification hashes
  and definition hashes are computed from the real candidate JSON. Passing these
  fixtures does not verify artifact bytes or the truth of supplied measurements.
- Positive continuity tests create a separate synthetic candidate definition with
  explicit anchors and a new version/hash. They do not modify or qualify the
  packaged catalog. Both sides carry the complete supplied semantic asset.

## Contract boundaries

Text ranges are UTF-16 `[start,end)` offsets into the canonical field. Spans use
relative offsets, never a second editable text string. Every visible field is
reconstructed completely in reading order. Boundaries cannot split a surrogate,
combining sequence or ZWJ grapheme. Long words remain exact; determining whether
real glyphs fit belongs to Q03/Q06. An allegedly measured density greater than one
already fails structurally; density at one does not prove visual fit.

The five candidate layouts support eyebrow, title and body only. Any nonempty code
or number field, including numeric zero, is rejected rather than dropped or
converted. Empty code/number strings add no visible text. Caption, overall CTA,
hashtags, sources and alt text stay in the canonical carousel and cannot be
introduced as arbitrary slide blocks. Signature/logo areas remain reserved;
block IDs cannot impersonate another region or decoration.

Preview selection uses declared preflight risks, without SVG composition or
rasterization. It includes the cover, representative internal slide, densest
internal, highest-risk diagram and both sides of required seams. Selection is
bounded by six slides; missing measurements and omitted required coverage fail.
This does not implement the trusted preflight or a render/approval gate.
Semantic sets are normalized deterministically before freezing; block/span reading
order is preserved. Reason codes use the fixed policy-v1 enum order.

The packaged catalog contains exactly five **candidate** records, with no evidence
or release. Its decorative choices, overlap allowlists and continuity anchor lists
are empty: those features are not currently offered by these candidates. The
closed structures can validate explicitly defined synthetic candidates without
silently expanding the catalog. `maxOverlaps:2` is a ceiling, not an authorization
for any pair. There is no production `allowUnqualified` option.

`checkerRef` and `rubricRef` are present but null only in candidates, because Q06
has not supplied real resources. Completing either field changes `definitionHash`;
a successor candidate version and evidence over that final definition are required.
Evidence about a null-ref definition cannot qualify the later definition.
`assertQualifiedLayout` fails closed even for a structurally plausible fabricated
release: Q02 ships no trusted released catalog.

## Running

Focused portable tests:

    node --test tests/unit/composition-plan.test.mjs tests/unit/layout-qualification.test.mjs tests/unit/brand-schema.test.mjs tests/integration/doctor.test.mjs tests/integration/run-snapshot.test.mjs

Full regression:

    npm test

Temporary integration databases are closed before directory cleanup. Dynamic
imports use file URLs; paths are derived from `import.meta.url`, not Unix absolute
paths. Tests use existing installed dependencies and synthetic font bytes only for
resource/hash diagnostics. Those bytes are explicitly not real fonts and never
enter composition or font qualification. No Nimbus installation or transfer is
required for these tests.

Windows execution is a separate qualification step. A passing cloud test is not
Windows qualification, and a passing Windows structural suite would still not be
Q03/Q06 visual qualification or T33 installed CLI/plugin homologation.
