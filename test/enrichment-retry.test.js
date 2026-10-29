import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CacheManager,CACHE_TTL} from '../src/cache.js';
import {CollectionManager} from '../src/collection.js';
import {greenhouseProvider} from '../src/ats/greenhouse.js';
import {normalizeOptions} from '../src/filters.js';

async function scenario(fn,{count=8,failure=null}={}){
 const root=await mkdtemp(join(tmpdir(),'enrichment-retry-'));let now=Date.now(),bulk=0,details=0;
 const cache=new CacheManager({root,now:()=>now});
 await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:[{id:'example',region:'global',status:'valid'}],cursors:{},nextDiscoveryAt:new Date(now+86400000).toISOString(),coverageComplete:true});
 const raw=id=>({id,title:count===1?'Generalist':'Software Specialist',company_name:'Example',absolute_url:`https://example.com/jobs/${id}`});
 const http={json:async value=>{const url=new URL(value);if(url.searchParams.get('content')==='true'){bulk++;throw Object.assign(new Error('response exceeds the safe size limit.'),{code:'RESPONSE_TOO_LARGE'});}if(/\/jobs\/\d+$/.test(url.pathname)){details++;if(failure)throw Object.assign(new Error('detail unavailable'),{status:failure});return {...raw(Number(url.pathname.split('/').at(-1))),content:count===1?'Registered nurse duties.':'Software Engineer duties.'};}return {jobs:Array.from({length:count},(_,i)=>raw(12345+i))};}};
 const make=()=>new CollectionManager({cache,http,now:()=>now,maxEnrichments:2,maxBulkEnrichments:1});
 const options=normalizeOptions({search:count===1?'RN':'Software Engineer',website:'Greenhouse'});
 try{await fn({cache,http,options,make,advance:ms=>{now+=ms;},now:()=>now,counts:()=>({bulk,details})});}finally{await rm(root,{recursive:true,force:true});}
}

test('oversized bulk failures persist cooldowns without consuming the individual detail budget',()=>scenario(async c=>{
 const first=await c.make().find(greenhouseProvider,c.options);assert.equal(first.jobs.length,2);assert.deepEqual(c.counts(),{bulk:1,details:2});
 let snapshot=await c.cache.read('postings','Greenhouse:global:example');assert.equal(snapshot.data.enrichment.bulk.failureKind,'oversized');assert.equal(Date.parse(snapshot.data.enrichment.bulk.retryAt)-c.now(),86400000);
 await c.make().find(greenhouseProvider,{...c.options,limit:1});assert.equal(c.counts().bulk,1);assert.equal(c.counts().details,4);
 c.advance(CACHE_TTL.postings+1);const refreshed=await c.make().find(greenhouseProvider,c.options);assert.equal(c.counts().bulk,1);assert.ok(refreshed.stats.detailCacheHits>=4);snapshot=await c.cache.read('postings','Greenhouse:global:example');assert.ok(snapshot.data.jobs.filter(job=>job.descriptionCompleteness==='complete').length>=4);
}));

test('individual failed enrichment is cached across managers and retries only after its deadline',()=>scenario(async c=>{
 await c.make().find(greenhouseProvider,c.options);assert.equal(c.counts().details,1);
 await c.make().find(greenhouseProvider,{...c.options,limit:1});assert.equal(c.counts().details,1);
 const snapshot=await c.cache.read('postings','Greenhouse:global:example');assert.equal(snapshot.data.enrichment.details['12345'].failureKind,'transient');
 c.advance(5*60000+1);await c.make().find(greenhouseProvider,c.options);assert.equal(c.counts().details,2);
},{count:1,failure:500}));

test('unsupported individual detail routes use a bounded structural cooldown',()=>scenario(async c=>{
 await c.make().find(greenhouseProvider,c.options);c.advance(10*60000);await c.make().find(greenhouseProvider,c.options);assert.equal(c.counts().details,1);
 const snapshot=await c.cache.read('postings','Greenhouse:global:example');assert.equal(snapshot.data.enrichment.details['12345'].failureKind,'unsupported');assert.equal(Date.parse(snapshot.data.enrichment.details['12345'].retryAt)>c.now(),true);
},{count:1,failure:404}));
