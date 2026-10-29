import test from 'node:test';import assert from 'node:assert/strict';
import {smartRecruitersProvider,normalizeSmartRecruiters} from '../src/ats/smartrecruiters.js';
import {parsePersonio} from '../src/ats/personio.js';
import {normalizeFeed,himalayasProvider,remotiveProvider} from '../src/sources/feeds.js';
import {extractBoard} from '../src/discovery.js';import {personioProvider} from '../src/ats/personio.js';
const board={id:'example'};
test('SmartRecruiters public adapter paginates and enriches authoritative sections',async()=>{
 const raw={id:'123',name:'Chef',company:{name:'Kitchen'},releasedDate:'2026-10-01T00:00:00Z',visibility:'PUBLIC',jobAd:{sections:{jobDescription:{text:'<p>Prepare meals.</p>'}}}};
 const job=normalizeSmartRecruiters(raw,board);assert.equal(job.description,'Prepare meals.');assert.equal(job.company,'Kitchen');
 const result=await smartRecruitersProvider.fetchBoard(board,{json:async()=>({content:[raw],totalFound:1})});assert.equal(result.jobs.length,1);assert.equal(result.complete,true);
 assert.equal(normalizeSmartRecruiters({...raw,visibility:'INTERNAL'},board),null);
});
test('Personio XML stays public, preserves creation time and rejects entity declarations',()=>{
 const result=parsePersonio('<workzag-jobs><position><id>123</id><name>Accountant</name><office>Berlin</office><createdAt>2026-10-01T00:00:00Z</createdAt><jobDescriptions><jobDescription><value><![CDATA[Manage accounts.]]></value></jobDescription></jobDescriptions></position></workzag-jobs>',board);
 assert.equal(result.jobs[0].postedAt,null);assert.ok(result.jobs[0].createdAt);assert.equal(result.jobs[0].description,'Manage accounts.');
 assert.throws(()=>parsePersonio('<!DOCTYPE x><workzag-jobs/>',board));
 assert.equal(extractBoard('https://example.jobs.personio.com/job/123',personioProvider).domain,'com');
});
test('public feeds retain attribution, exact application URL, unknown dates and bounded cursors',async()=>{
 const raw={title:'Nurse',guid:'https://himalayas.app/companies/example/jobs/nurse',companyName:'Hospital',applicationLink:'https://himalayas.app/apply?utm_source=api',description:'<p>Care duties.</p>',pubDate:1790000000};
 const job=normalizeFeed(raw,'Himalayas');assert.equal(job.applicationUrl,raw.applicationLink);assert.match(job.exportRestrictions,/syndicate/);assert.equal(job.workplace,'remote');
 const h=await himalayasProvider.fetchBoard(board,{json:async()=>({jobs:[raw],nextCursor:'repeat'})},{pages:3});assert.equal(h.complete,false);assert.equal(h.pages,2);
 const r=await remotiveProvider.fetchBoard(board,{json:async()=>({jobs:[{id:1,title:'Nurse',url:'https://remotive.com/jobs/1',publication_date:'2026-10-01T12:00:00'}]})});assert.equal(r.jobs[0].postedAt,null);assert.equal(r.complete,true);
});
