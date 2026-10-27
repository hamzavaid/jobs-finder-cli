import test from 'node:test';
import assert from 'node:assert/strict';
import {greenhouseProvider,greenhouseUrl,normalizeGreenhouse} from '../src/ats/greenhouse.js';
import {leverProvider,leverUrl,normalizeLever} from '../src/ats/lever.js';
import {ashbyProvider,ashbyUrl,normalizeAshby} from '../src/ats/ashby.js';
const board = {id:'Example Co',region:'global'};
const gh = {id:123,title:'Pastry Chef',location:{name:'Boston'},absolute_url:'https://example.com/jobs/123',updated_at:'2026-10-27T00:00:00Z'};
const lever = {id:'abc-123',text:'Tax Accountant',categories:{location:'Remote',commitment:'Full-time'},hostedUrl:'https://jobs.lever.co/example/abc-123',createdAt:1700000000000};
const ashby = {id:'def-456',title:'Nurse',isListed:true,jobUrl:'https://jobs.ashbyhq.com/example/def-456',isRemote:true,workplaceType:'Hybrid',employmentType:'FullTime',publishedAt:'2026-10-26T12:00:00Z'};
test('Greenhouse list does not invent a publication date and content is opt-in', async () => {
  const job = normalizeGreenhouse(gh,board);
  assert.equal(job.source,'Greenhouse'); assert.equal(job.postedAt,null); assert.ok(job.updatedAt);
  assert.equal(job.companyEvidence,'board-identifier'); assert.equal(job.verified,null);
  assert.ok(!greenhouseUrl(board).includes('content='));
  assert.match(greenhouseUrl(board,{content:true}),/content=true/);
  const detail = await greenhouseProvider.fetchDetail(board,123,{json:async () => ({...gh,company_name:'Example Company',first_published:'2026-10-01T12:00:00Z',content:'&lt;p&gt;Bake &amp; decorate&lt;/p&gt;'})});
  assert.equal(detail.company,'Example Company'); assert.equal(detail.postedAt,'2026-10-01T12:00:00.000Z');
  assert.equal(detail.description,'Bake & decorate');
  await assert.rejects(greenhouseProvider.fetchDetail(board,123,{json:async () => ({...gh,id:456})}),/mismatch/);
});
test('Lever uses text/categories and keeps creation date separate from publication', () => {
  const job = normalizeLever(lever,board);
  assert.equal(job.title,'Tax Accountant'); assert.equal(job.workplace,'remote');
  assert.equal(job.postedAt,null); assert.ok(job.createdAt); assert.equal(job.applicantCount,null);
  assert.match(leverUrl({...board,region:'eu'}),/^https:\/\/api.eu.lever.co/);
});
test('Lever paginates arrays, deduplicates and marks truncation without claiming completeness', async () => {
  const calls = [], page = Array.from({length:100},(_,id) => ({...lever,id:String(id)}));
  const result = await leverProvider.fetchBoard(board,{json:async url => {calls.push(url); return calls.length === 1 ? page : [{...lever,id:'new'}];}},{pages:2});
  assert.equal(result.jobs.length,101); assert.equal(result.complete,true); assert.match(calls[1],/skip=100/);
  const partial = await leverProvider.fetchBoard(board,{json:async () => page},{pages:1});
  assert.equal(partial.complete,false);
});
test('Ashby explicit hybrid wins over remote boolean; boolean alone stays uncertain', async () => {
  assert.equal(normalizeAshby(ashby,board).workplace,'hybrid');
  assert.equal(normalizeAshby({...ashby,workplaceType:undefined},board).workplace,null);
  assert.equal(normalizeAshby(ashby,board).postedAt,'2026-10-26T12:00:00.000Z');
  assert.match(ashbyUrl(board),/includeCompensation=true/);
  const result = await ashbyProvider.fetchBoard(board,{json:async () => ({jobs:[ashby,{...ashby,isListed:false}]})});
  assert.equal(result.jobs.length,1);
});
test('malformed payloads, unsafe identifiers and unsafe links are rejected', async () => {
  for (const provider of [greenhouseProvider,leverProvider,ashbyProvider]) await assert.rejects(provider.fetchBoard(board,{json:async () => ({bad:true})}));
  for (const id of ['../evil','a/b','%2f','localhost?x=y','assets']) assert.throws(() => greenhouseUrl({id}));
  assert.equal(normalizeGreenhouse({...gh,absolute_url:'javascript:alert(1)'},board),null);
  assert.equal(normalizeGreenhouse({...gh,title:{unexpected:true}},board),null);
});

test('Lever keeps completed pages when a later API request fails', async () => {
  let calls = 0;
  const rows = Array.from({length:100},(_,id) => ({...lever,id:String(id)}));
  const result = await leverProvider.fetchBoard(board,{json:async () => {if (calls++) throw Object.assign(new Error('HTTP 429'),{status:429});return rows;}},{pages:3});
  assert.equal(result.jobs.length,100);assert.equal(result.complete,false);assert.equal(result.errorStatus,429);assert.match(result.reason,/pagination failed/);
});
