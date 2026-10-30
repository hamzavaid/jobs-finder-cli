import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {saveJobs,savedJobs} from '../src/store.js';
test('summary and concurrent saves preserve dated details while permitting explicit changes and removals',async()=>{
 const root=await mkdtemp(join(tmpdir(),'store-evidence-'));try{
  const path=join(root,'jobs.json'),old='2026-10-28T00:00:00Z';
  // Legacy unqualified record must be merged, not lost during migration.
  await writeFile(path,JSON.stringify({version:1,jobs:{'100001':{id:'100001',title:'Chef',description:'Full duties',descriptionCompleteness:'complete',postedAt:'2026-10-01T00:00:00Z',datePrecision:'instant',lastObservedAt:old}}}));
  await Promise.all([saveJobs([{id:'100001',title:'Chef',description:null,postedAt:null,lastObservedAt:'2026-10-29T00:00:00Z'}],path),saveJobs([{id:'100002',title:'Nurse'}],path)]);
  let jobs=await savedJobs(path),job=jobs.find(job=>job.id==='100001');assert.equal(jobs.length,2);assert.equal(job.description,'Full duties');assert.equal(job.postedAt,'2026-10-01T00:00:00Z');assert.equal(job.fieldEvidence.description.observedAt,old);
  await saveJobs([{id:'100001',title:'Junior Chef',workplace:'remote',lastObservedAt:'2026-10-30T00:00:00Z'}],path);job=(await savedJobs(path)).find(job=>job.id==='100001');assert.equal(job.title,'Junior Chef');assert.equal(job.workplace,'remote');
  await saveJobs([{id:'100001',removedFields:['description','postedAt'],lastObservedAt:'2026-10-31T00:00:00Z'}],path);job=(await savedJobs(path)).find(job=>job.id==='100001');assert.equal(job.description,null);assert.equal(job.postedAt,null);assert.equal(job.datePrecision,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
