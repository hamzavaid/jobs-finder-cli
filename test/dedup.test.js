import test from 'node:test';import assert from 'node:assert/strict';import {consolidateJobs} from '../src/dedup.js';
const job={source:'Greenhouse',id:'a',boardId:'acme',providerJobId:'12345',title:'Chef',company:'Acme Inc',companyEvidence:'observed',url:'https://jobs.example.com/jobs/12345',description:'Prepare meals and manage kitchen',descriptionCompleteness:'complete'};
test('strong duplicate identities consolidate originals and provenance before result limiting',()=>{
 const result=consolidateJobs([job,{...job,source:'GitHub',id:'b',url:job.url+'?utm_source=github'}]);assert.equal(result.jobs.length,1);assert.equal(result.confirmed,1);assert.equal(result.jobs[0].originalRecords.length,2);assert.equal(result.jobs[0].provenance.length,2);
});
test('employer conflicts and distinct requisitions never merge; similar titles alone are insufficient',()=>{
 for(const other of [{...job,company:'Other'},{...job,requisitionId:'B'},{...job,url:'https://jobs.example.com/jobs/99999',description:'Different duties'}]){const result=consolidateJobs([{...job,requisitionId:'A'},{...other,source:'Lever',id:'b'}]);assert.equal(result.jobs.length,2);}
 const strong=consolidateJobs([{...job,requisitionId:'R',employerIdentity:{id:'employer.example',verified:true}},{...job,source:'Lever',id:'b',url:'https://jobs.example.com/jobs/99999',requisitionId:'R',employerIdentity:{id:'employer.example',verified:true}}]);assert.equal(strong.jobs.length,1);
});
