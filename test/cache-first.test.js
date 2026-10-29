import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CacheManager,CACHE_TTL} from '../src/cache.js';
import {CollectionManager,postingRevision,searchCacheKey} from '../src/collection.js';
import {inventoryFingerprint} from '../src/discovery.js';
import {normalizeOptions} from '../src/filters.js';
import {PARSER_VERSION} from '../src/schema.js';
import {normalizeGreenhouse,greenhouseProvider} from '../src/ats/greenhouse.js';

export async function seeded(fn,{stale=true}={}) {
 const root=await mkdtemp(join(tmpdir(),'cache-first-'));let now=Date.now(),requests=0;
 const cache=new CacheManager({root,now:()=>now});
 const board={id:'example',region:'global',status:'valid',retryAt:new Date(now+3600000).toISOString()};
 const observed=new Date(now-(stale?CACHE_TTL.postings+1000:1000)).toISOString();
 const job={...normalizeGreenhouse({id:12345,title:'Software Engineer',company_name:'Example',absolute_url:'https://example.com/jobs/12345',content:'Build software.'},board),lastObservedAt:observed};
 const data={provider:'Greenhouse',board,jobs:[job],complete:true,pages:1,content:true,parserVersion:PARSER_VERSION,lastSuccessfulFetchAt:observed,revision:postingRevision([job])};
 await cache.put('postings','Greenhouse:global:example',data,{ttl:stale?-1000:CACHE_TTL.postings});
 await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:[board],cursors:{},coverageComplete:false,nextDiscoveryAt:new Date(now+3600000).toISOString(),lastDiscoveryErrors:['Archive previously unavailable.']});
 const http={text:async()=>{requests++;throw new Error('archive unavailable');},json:async()=>{requests++;throw new Error('network must not repeat');}};
 const options=normalizeOptions({search:'Software Engineer',website:'Greenhouse'});
 const manager=new CollectionManager({cache,http,now:()=>now,discoveryOptions:{fallback:false}});
 try {await fn({root,cache,board,data,job,manager,http,options,now:()=>now,advance:ms=>{now+=ms;},requests:()=>requests});}finally{await rm(root,{recursive:true,force:true});}
}

test('stale partial searches persist a three-minute exact cache with original warnings and timestamps',()=>seeded(async c=>{
 const first=await c.manager.find(greenhouseProvider,c.options);
 const record=await c.cache.read('search',searchCacheKey(c.options,'Greenhouse'));
 assert.ok(record,'partial stale results must be cached');assert.equal(Date.parse(record.expiresAt)-c.now(),180000);
 const count=c.requests();
 await c.cache.update('inventory','Greenhouse',inventory=>({...inventory,nextDiscoveryAt:null,lastAttemptAt:new Date(c.now()).toISOString()}));
 const second=await new CollectionManager({cache:c.cache,http:c.http,now:c.now}).find(greenhouseProvider,c.options);
 assert.equal(second.stats.exactCacheHit,true);assert.equal(c.requests(),count);
 assert.deepEqual(second.stats.errors,first.stats.errors);assert.deepEqual(second.jobs,first.jobs);
 assert.equal(second.jobs[0].cacheStatus,'stale');assert.equal(second.jobs[0].lastObservedAt,c.job.lastObservedAt);
 c.advance(180001);const third=await c.manager.find(greenhouseProvider,c.options);assert.notEqual(third.stats.exactCacheHit,true);
}));

test('exact validation rejects missing or corrupted posting snapshots without trusting a remaining manifest',()=>seeded(async c=>{
 await c.manager.find(greenhouseProvider,c.options);
 const path=c.cache.path('postings','Greenhouse:global:example');await unlink(path);
 const missing=await c.manager.find(greenhouseProvider,c.options).catch(error=>({error}));assert.notEqual(missing.stats?.exactCacheHit,true);
 await c.cache.put('postings','Greenhouse:global:example',c.data,{ttl:CACHE_TTL.postings});await c.manager.find(greenhouseProvider,c.options);
 await writeFile(path,'invalid json');
 const corrupt=await c.manager.find(greenhouseProvider,c.options).catch(error=>({error}));assert.notEqual(corrupt.stats?.exactCacheHit,true);
},{stale:false}));

test('stale retention, membership, filters, parser and revision changes invalidate exact results',()=>seeded(async c=>{
 await c.manager.find(greenhouseProvider,c.options);
 const key=searchCacheKey(c.options,'Greenhouse'),saved=(await c.cache.read('search',key)).data;
 for(const change of [{parserVersion:PARSER_VERSION-1},{inventoryFingerprint:'changed'}]) {
  await c.cache.put('search',key,{...saved,...change},{ttl:180000});const result=await c.manager.find(greenhouseProvider,c.options);assert.notEqual(result.stats.exactCacheHit,true);
 }
 assert.notEqual(searchCacheKey({...c.options,company:'Elsewhere'},'Greenhouse'),key);
 await c.cache.put('postings','Greenhouse:global:example',{...c.data,revision:'changed'},{ttl:-1000});const result=await c.manager.find(greenhouseProvider,c.options);assert.notEqual(result.stats.exactCacheHit,true);
 c.advance(CACHE_TTL.stale+1);await assert.rejects(c.manager.find(greenhouseProvider,c.options),/no board data/);
}));

test('inventory fingerprints ignore refresh timestamps and observation statistics',()=>{
 const board={id:'example',region:'global',status:'valid'};
 assert.equal(inventoryFingerprint({boards:[board]}),inventoryFingerprint({boards:[{...board,lastJobFetchAt:'changed',queryStats:{changed:true}}],revision:'different'}));
 assert.notEqual(inventoryFingerprint({boards:[board]}),inventoryFingerprint({boards:[board,{id:'new',status:'pending'}]}));
});
