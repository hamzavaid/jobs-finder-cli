import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CacheManager} from '../src/cache.js';import {CollectionManager,postingRevision} from '../src/collection.js';import {PARSER_VERSION,normalizeJob} from '../src/schema.js';import {ashbyProvider} from '../src/ats/ashby.js';import {normalizeOptions} from '../src/filters.js';
async function fixture(work,dates) {
 const root=await mkdtemp(join(tmpdir(),'dated-cache-'));let time=Date.parse('2026-10-29T12:00:00Z'),requests=0;
 const now=()=>time,cache=new CacheManager({root,now}),stamp=new Date(time).toISOString(),board={id:'example',status:'valid',retryAt:new Date(time+86400000).toISOString()};
 const jobs=dates.map((date,i)=>normalizeJob({source:'Ashby',id:String(i),title:'Chef',company:'Kitchen',description:'Prepare meals',descriptionCompleteness:'complete',url:`https://jobs.ashbyhq.com/example/${i}`,postedAt:date.value,datePrecision:date.precision||'instant',lastObservedAt:stamp}));
 await cache.put('inventory','Ashby',{provider:'Ashby',boards:[board],cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(time+3600000).toISOString()});
 await cache.put('postings','Ashby:global:example',{board,jobs,complete:true,pages:1,revision:postingRevision(jobs),parserVersion:PARSER_VERSION,lastSuccessfulFetchAt:stamp},{ttl:1200000});
 const manager=new CollectionManager({cache,now,http:{json:async()=>{requests++;throw new Error('unexpected network');}}}),options=normalizeOptions({website:'Ashby',search:'Chef',date:'1d'});
 try{await work({cache,manager,options,advance:ms=>{time+=ms;},requests:()=>requests});}finally{await rm(root,{recursive:true,force:true});}
}
test('rolling-date exact cache reuses manifests and expires at the next accepted-job boundary',()=>fixture(async c=>{
 assert.equal((await c.manager.find(ashbyProvider,c.options)).jobs.length,1);const reads=c.cache.metrics.postingReads;
 const second=await c.manager.find(ashbyProvider,c.options);assert.equal(second.stats.exactCacheHit,true);assert.equal(c.cache.metrics.postingReads,reads);assert.equal(c.requests(),0);
 c.advance(60001);const expired=await c.manager.find(ashbyProvider,c.options);assert.equal(expired.jobs.length,0);assert.equal(expired.stats.exactCacheHit,false);
},[{value:'2026-10-28T12:01:00Z'}]));
test('cached empty date searches expire before future postings become eligible',()=>fixture(async c=>{
 assert.equal((await c.manager.find(ashbyProvider,c.options)).jobs.length,0);assert.equal((await c.manager.find(ashbyProvider,c.options)).stats.exactCacheHit,true);
 c.advance(30001);assert.equal((await c.manager.find(ashbyProvider,c.options)).jobs.length,1);
},[{value:'2026-10-29T12:00:30Z'}]));
test('calendar-date caches respect the entire timezone uncertainty envelope',()=>fixture(async c=>{
 const options={...c.options,dateSeconds:7*86400};
 assert.equal((await c.manager.find(ashbyProvider,options)).jobs.length,0);assert.equal((await c.manager.find(ashbyProvider,options)).stats.exactCacheHit,true);
 c.advance(2*3600000);assert.equal((await c.manager.find(ashbyProvider,options)).jobs.length,1);
},[{value:'2026-10-28',precision:'day'}]));
