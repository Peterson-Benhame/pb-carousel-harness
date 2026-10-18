import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';
import {loadQualifiedQualityResources} from '../../src/application/quality-resources.mjs';
import {makeQualityPackage} from '../helpers/quality-service-fixture.mjs';

async function evidenceFixture(t,change){
 const f=await makeQualityPackage(t),snapshot=structuredClone(f.snapshot),manifest=structuredClone(f.manifest),file='shared/layouts/editorial-composed-v1.json',catalog=JSON.parse(await readFile(path.join(f.packageRoot,file),'utf8'));
 change(catalog);
 for(const q of catalog.qualifications){const ref=snapshot.qualifications.find(r=>r.id===q.id);ref.sha256=canonicalHash(q);}
 const bytes=canonicalJson(catalog);await writeFile(path.join(f.packageRoot,file),bytes);const digest=sha256(Buffer.from(bytes));manifest.renderers.find(r=>r.id==='editorial-composed@1').hashes[file]=digest;snapshot.renderer.files[file]=digest;snapshot.runtime.renderer.files[file]=digest;snapshot.resourceManifestRef.sha256=canonicalHash(manifest);await writeFile(path.join(f.packageRoot,'shared/resources.manifest.json'),canonicalJson(manifest));return {packageRoot:f.packageRoot,snapshot};
}
test('qualification resolves each evidence environment without inferring another platform',async t=>{
 const f=await evidenceFixture(t,catalog=>{
  for(const q of catalog.qualifications){const other={...q.release.qualifiedEnvironments[0],platform:process.platform==='win32'?'linux':'win32'};q.release.qualifiedEnvironments.push(other);q.release.qualifiedEnvironments.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);
   const copies=q.evidenceRefs.map(ref=>{const old=catalog.evidence.find(e=>canonicalJson(e.ref)===canonicalJson(ref)),data={...old.data,version:2,environment:other},next={...ref,version:2,sha256:canonicalHash(data)};catalog.evidence.push({ref:next,data});return next;});q.evidenceRefs.push(...copies);q.evidenceRefs.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);
  }
 });assert.equal((await loadQualifiedQualityResources(f)).qualifications.length,5);
});
test('evidence only from another allowed environment cannot qualify the current one',async t=>{
 const f=await evidenceFixture(t,catalog=>{
  for(const q of catalog.qualifications){const other={...q.release.qualifiedEnvironments[0],platform:process.platform==='win32'?'linux':'win32'};q.release.qualifiedEnvironments.push(other);q.release.qualifiedEnvironments.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);
   for(const ref of q.evidenceRefs){const item=catalog.evidence.find(e=>canonicalJson(e.ref)===canonicalJson(ref));item.data.environment=other;ref.sha256=canonicalHash(item.data);item.ref=structuredClone(ref);}q.evidenceRefs.sort((a,b)=>canonicalJson(a)<canonicalJson(b)?-1:1);q.release.reviewEvidenceRef=q.evidenceRefs.find(e=>e.kind==='qualification-review');
  }
 });await assert.rejects(loadQualifiedQualityResources(f),{code:'LAYOUT_NOT_QUALIFIED'});
});
for(const field of ['sha256','samplePolicyRef'])test(`policy ${field} remains bound to exact local implementation`,async t=>{
 const f=await makeQualityPackage(t),snapshot=structuredClone(f.snapshot);if(field==='sha256')snapshot.qualityPolicy.sha256='0'.repeat(64);else snapshot.qualityPolicy.samplePolicyRef.sha256='0'.repeat(64);await assert.rejects(loadQualifiedQualityResources({packageRoot:f.packageRoot,snapshot}),{code:'RUNTIME_MISMATCH'});
});
