import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityInput } from '../helpers/quality-render-fixture.mjs';

const qualification = (id, version, layoutId) => ({
  id,
  version,
  definition: { layoutId },
  definitionHash: String(version).repeat(64),
});

test('quality input selects only plan qualifications by exact id and version', () => {
  const coverV2 = qualification('qualification-cover-editorial@1', 2, 'cover-editorial@1');
  const flowV2 = qualification('qualification-content-flow@1', 2, 'content-flow@1');
  const coverV1 = qualification('qualification-cover-editorial@1', 1, 'cover-editorial@1');
  const flowV1 = qualification('qualification-content-flow@1', 1, 'content-flow@1');
  const qualifications = [coverV2, flowV2, coverV1, flowV1];
  const refs = qualifications.map(record => ({
    id: record.id,
    version: record.version,
    sha256: String(record.version).repeat(64),
    definitionHash: record.definitionHash,
  }));
  const f = {
    carousel: {},
    plan: {
      brandId: 'brand',
      runId: 'run',
      slides: [
        { qualificationRef: refs[0] },
        { qualificationRef: refs[1] },
      ],
    },
    snapshot: { runtime: {}, fonts: [] },
    resources: { fonts: [], assets: [], logos: [] },
    qualifications,
  };
  const result = {
    selection: { allSlides: true, slideIndices: [1, 2], seamPairs: [] },
    slides: [],
    seams: [],
    panorama: null,
    snapshotHash: 'a'.repeat(64),
    planHash: 'b'.repeat(64),
    resources: { renderer: { id: 'editorial-composed@1', files: {} }, qualifications: refs },
  };

  const input = qualityInput(f, result);
  const identity = record => [record.id, record.version];
  assert.deepEqual(input.qualification.map(identity), [
    ['qualification-cover-editorial@1', 2],
    ['qualification-content-flow@1', 2],
  ]);
  assert.deepEqual(input.manifest.qualifications.map(identity), [
    ['qualification-cover-editorial@1', 2],
    ['qualification-content-flow@1', 2],
  ]);
});
