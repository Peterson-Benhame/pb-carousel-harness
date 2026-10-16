import { verifySchema } from './migrations.mjs';

/** Internal persistence queries, not an authorization or public service API. */
export function createRepositories(db) {
  function get(sql,...args) { verifySchema(db); return db.prepare(sql).get(...args) ?? null; }
  return Object.freeze({
    listBrands() { verifySchema(db); return db.prepare('SELECT * FROM brands ORDER BY id').all(); },
    getBrand(brandId) { return get('SELECT * FROM brands WHERE id=?',brandId); },
    getBrandRevision(brandId,revision) { return get('SELECT * FROM brand_revisions WHERE brand_id=? AND revision=?',brandId,revision); },
    getAsset(brandId,id) { return get('SELECT * FROM assets WHERE brand_id=? AND id=?',brandId,id); },
    getRun(brandId,id) { return get('SELECT * FROM runs WHERE brand_id=? AND id=?',brandId,id); },
    getArtifact(brandId,runId,id) { return get('SELECT * FROM artifacts WHERE brand_id=? AND run_id=? AND id=?',brandId,runId,id); },
  });
}
