import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {initializeWorkspace} from '../../src/infrastructure/sqlite/database.mjs';
import {createRunInputs} from '../../src/application/run-inputs.mjs';
import {canonicalHash,canonicalJson} from '../../src/domain/canonical-json.mjs';
import {sha256} from '../../src/infrastructure/resources.mjs';
import {qualitySnapshotFixture} from '../fixtures/quality/snapshot-fixture.mjs';
import {compositionFixture} from '../fixtures/quality/composition-fixture.mjs';

export async function qualityStateFixture(t,options={}){
 const data=await qualitySnapshotFixture(),root=await mkdtemp(path.join(os.tmpdir(),'carousel-q04 estado ')),dataDir=path.join(root,'workspace');
 const db=await initializeWorkspace(dataDir,{schemaVersion:2});
 t.after(async()=>{if(db.open)db.close();await rm(root,{recursive:true,force:true});});
 const brandId=data.snapshot.brand.id,runId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 db.prepare('INSERT INTO brands(id) VALUES(?)').run(brandId);
 db.prepare("INSERT INTO brand_revisions(brand_id,revision,config_json,hash,provenance) VALUES(?,1,?,?,'user-confirmed')").run(brandId,canonicalJson(data.snapshot.brand.config),data.snapshot.brand.revisionHash);
 db.prepare('UPDATE brands SET current_revision=1 WHERE id=?').run(brandId);
 db.prepare('INSERT INTO runs(id,brand_id,brand_revision,snapshot_json,snapshot_hash) VALUES(?,?,1,?,?)').run(runId,brandId,canonicalJson(data.snapshot),canonicalHash(data.snapshot));
 const inputs=await createRunInputs({root:dataDir,db,qualifications:data.qualifications,...options});
 const composition=await compositionFixture();
 async function file(name,bytes){const sourcePath=path.join(root,name);await writeFile(sourcePath,bytes);return {sourcePath,sha256:sha256(bytes)};}
 const request={brandId,runId};
 async function save(){return inputs.save({requestId:randomUUID(),...request,expectedVersion:db.prepare('SELECT version FROM runs WHERE id=?').get(runId).version,carousel:await file('carousel.json',JSON.stringify(composition.carousel)),concept:await file('concept.md','Synthetic concept')});}
 function plan(saved){const p=structuredClone(composition.plan);p.id=randomUUID();p.brandId=brandId;p.runId=runId;p.snapshotHash=canonicalHash(data.snapshot);p.carouselRef=saved.artifacts.carousel;p.conceptRef=saved.artifacts.concept;p.copyFingerprint=saved.fingerprints['copy-approval'];
  for(const slide of p.slides){const q=data.qualifications.find(q=>q.definition.layoutId===slide.layoutId);slide.qualificationRef={id:q.id,version:q.version,sha256:canonicalHash(q),definitionHash:q.definitionHash};}return p;
 }
 function step(key,status='succeeded',fingerprint='a'.repeat(64)){const id=randomUUID();db.prepare('INSERT INTO steps(id,brand_id,run_id,step_key,status,fingerprint) VALUES(?,?,?,?,?,?) ON CONFLICT(brand_id,run_id,step_key) DO UPDATE SET status=excluded.status,fingerprint=excluded.fingerprint').run(id,brandId,runId,key,status,fingerprint);return db.prepare('SELECT id FROM steps WHERE run_id=? AND step_key=?').get(runId,key).id;}
 return {...data,root,dataDir,db,inputs,request,save,plan,step,composition,file};
}
