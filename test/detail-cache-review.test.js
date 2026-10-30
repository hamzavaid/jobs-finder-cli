import test from 'node:test';import assert from 'node:assert/strict';
import {searchProvider} from '../src/provider-search.js';import {normalizeOptions,FILTER_VERSION} from '../src/filters.js';import {normalizeJob,PARSER_VERSION} from '../src/schema.js';
const stamp='2026-10-29T12:00:00Z';
const card=(id,extra={})=>normalizeJob({source:'LinkedIn',id,title:'Chef',company:'Kitchen',url:`https://www.linkedin.com/jobs/view/${id}/`,description:null,detailsFetched:false,lastObservedAt:stamp,...extra});
function fixture(cards,cached,detail=job=>({...job,description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true})) {
 const provider={name:'LinkedIn',cacheSearch:true,facets:()=>[],searchUrl:()=> 'https://www.linkedin.com/jobs/search',parseCards:()=>cards.map(job=>({...job})),emptyPattern:/empty/,detailUrl:id=>`https://www.linkedin.com/jobs/view/${id}/`,parseDetail:(html,job)=>detail(job)};
 const cache={read:async(kind,key)=>kind==='html-detail'&&cached.has(key)?{data:{parserVersion:PARSER_VERSION,job:cached.get(key)}}:null,put:async()=>{},fresh:record=>!!record,withLock:async(kind,key,work)=>work()};
 let requests=0;return {run:extra=>searchProvider(provider,normalizeOptions({website:'LinkedIn',search:'Chef',pages:1,...extra}),{get:async()=>{requests++;return '<html>fixture</html>';}},()=>{},{cache}),requests:()=>requests};
}
const key=id=>`LinkedIn:${id}:${PARSER_VERSION}:${FILTER_VERSION}`;
test('cached detail cannot erase a newly observed workplace or replace current card values',async()=>{
 const current=card('100001',{workplace:'remote'}),old=card('100001',{description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true,seniorityLevel:'Entry level',workplace:null,lastObservedAt:'2026-10-28T12:00:00Z'});
 const f=fixture([current],new Map([[key(current.id),old]]));
 const result=await f.run({remote:'true',experience:'entry'});
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].workplace,'remote');assert.equal(f.requests(),1);
 const uncached=fixture([current],new Map(),job=>({...job,description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true,seniorityLevel:'Entry level'}));
 assert.deepEqual((await uncached.run({remote:'true',experience:'entry'})).jobs.map(job=>[job.id,job.workplace,job.seniorityLevel]),result.jobs.map(job=>[job.id,job.workplace,job.seniorityLevel]));
});
export {fixture,card,key};
test('cached descriptions remain usable after the network exploration allowance is exhausted',async()=>{
 const cards=['100001','100002','100003'].map(id=>card(id,{title:'Specialist'}));
 const cached=card('100003',{title:'Specialist',description:'Chef duties',descriptionCompleteness:'complete',detailsFetched:true});
 const f=fixture(cards,new Map([[key(cached.id),cached]]),job=>({...job,description:null,detailsFetched:false}));
 const result=await f.run();assert.deepEqual(result.jobs.map(job=>job.id),['100003']);assert.equal(result.stats.detailCacheHits,1);assert.equal(result.stats.detailRequests,2);assert.equal(f.requests(),3);
});
test('complete descriptions do not suppress requests for unresolved filter metadata',async()=>{
 const job=card('100001',{description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true});
 const f=fixture([job],new Map(),current=>({...current,seniorityLevel:'Entry level'}));
 const result=await f.run({experience:'entry'});assert.equal(result.jobs.length,1);assert.equal(result.stats.detailRequests,1);
 const known=fixture([{...job,seniorityLevel:'Entry level'}],new Map());
 assert.equal((await known.run({experience:'entry'})).stats.detailRequests,0);
});
