import test from 'node:test';import assert from 'node:assert/strict';import {findJobs} from '../src/search.js';import {createHttpClient} from '../src/http.js';import {normalizeOptions} from '../src/filters.js';import {cacheDiagnostics} from '../src/pipeline-metrics.js';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {CacheManager} from '../src/cache.js';
test('HTML-only diagnostics separate logical calls, actual attempts and retries',async()=>{
 let fetches=0;const http=createHttpClient({delayMs:0,sleep:async()=>{},fetchImpl:async()=>new Response(++fetches===1?'unavailable':'<ul></ul>',{status:fetches===1?503:200})});
 const result=await findJobs(normalizeOptions({website:'LinkedIn',search:'Chef',pages:1}),http,{cache:false});
 assert.equal(result.stats.metrics.htmlRequests,2);assert.equal(result.stats.metrics.htmlLogicalCalls,1);assert.equal(result.stats.metrics.htmlRetries,1);
 const lines=cacheDiagnostics(result.stats,0).join('\n');assert.match(lines,/Network requests:.*2 public HTML attempts/);assert.match(lines,/discovery unavailable/);assert.ok(result.stats.timings.collectionMs>=0);
});
test('uninstrumented custom transports do not report fabricated attempt or stage counts',async()=>{
 const result=await findJobs(normalizeOptions({website:'LinkedIn',search:'Chef',pages:1}),{get:async()=>'<ul></ul>'},{cache:false});
 assert.equal(result.stats.metrics.htmlLogicalCalls,1);assert.equal(result.stats.metrics.htmlRequests,undefined);
 assert.match(cacheDiagnostics(result.stats,0).join('\n'),/unavailable public HTML attempts/);
});
test('HTML failures expose measured attempts and exact cache hits reset transport counters',async()=>{
 const options=normalizeOptions({website:'LinkedIn',search:'Chef',pages:1});
 await assert.rejects(findJobs(options,createHttpClient({delayMs:0,fetchImpl:async()=>new Response('denied',{status:403})}),{cache:false}),error=>error.stats.metrics.htmlRequests===1 && error.stats.metrics.htmlRetries===0);
 const root=await mkdtemp(join(tmpdir(),'metrics-cache-'));try{
  const cache=new CacheManager({root}),http=createHttpClient({delayMs:0,fetchImpl:async()=>new Response('<ul></ul>')});
  await findJobs(options,http,{cache});const warm=await findJobs(options,http,{cache});assert.equal(warm.stats.metrics.htmlRequests,0);assert.equal(warm.stats.metrics.htmlLogicalCalls,0);assert.equal(warm.stats.exactCacheHits,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
