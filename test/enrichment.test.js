import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichOnce,preserveEnrichment} from '../src/enrichment.js';
test('enrichment requests share in-flight work and preserve richer cached fields',async()=>{
  let calls=0;const http={},job={id:'1',description:null};
  const provider={name:'Example',enrichJob:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {...job,description:'Accounting duties',descriptionCompleteness:'complete',postedAt:'2026-10-01T00:00:00Z'};}};
  const [a,b]=await Promise.all([enrichOnce(provider,{},job,http),enrichOnce(provider,{},job,http)]);
  assert.equal(calls,1);assert.deepEqual(a,b);
  assert.equal(preserveEnrichment(a,job).description,'Accounting duties');
});
