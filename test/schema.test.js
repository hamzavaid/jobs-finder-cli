import test from 'node:test';import assert from 'node:assert/strict';import {normalizeJob,validateJob,validSourceDate} from '../src/schema.js';import {greenhouseProvider} from '../src/ats/greenhouse.js';
test('normalized contract validates identities dates salary and missing evidence',()=>{
 const job=normalizeJob({source:'Example',id:'1',title:'Accountant',url:'https://example.com/jobs/1',salary:{min:-1,currency:'USD'},postedAt:'2026-02-30',description:null});assert.equal(job.salary,null);assert.equal(job.postedAt,null);assert.equal(job.descriptionCompleteness,'title-only');assert.equal(job.employerIdentity,null);assert.equal(validateJob(job).valid,true);assert.equal(validateJob(job,{complete:true}).valid,false);assert.equal(validSourceDate('2026-01-01T00:00:00'),false);assert.equal(validateJob({...job,url:'javascript:bad'}).valid,false);
});
test('a malformed ATS record is quarantined without discarding healthy siblings',async()=>{
 const result=await greenhouseProvider.fetchBoard({id:'example'},{json:async()=>({jobs:[null,{id:1,title:'Nurse',absolute_url:'https://example.com/1'},{id:2,title:{bad:true},absolute_url:'https://example.com/2'}]})});assert.equal(result.jobs.length,1);assert.equal(result.rejected,2);assert.equal(result.complete,false);
});
