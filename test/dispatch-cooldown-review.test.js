import test from 'node:test';import assert from 'node:assert/strict';import {createHttpClient} from '../src/http.js';
test('queued cross-query requests stop after same-host denial without another network attempt',async()=>{
 let requests=0;const http=createHttpClient({delayMs:0,retries:0,fetchImpl:async()=>{requests++;return new Response('denied',{status:403});}});
 const outcomes=await Promise.allSettled([http.get('https://www.linkedin.com/jobs/search?keywords=Chef'),http.get('https://www.linkedin.com/jobs/search?keywords=Nurse')]);
 assert.ok(outcomes.every(result=>result.status==='rejected'));assert.equal(requests,1);assert.equal(outcomes[1].reason.code,'PROVIDER_COOLDOWN');
});
test('dispatch preflight can observe a persisted denial without counting a network attempt',async()=>{
 let requests=0;const http=createHttpClient({delayMs:0,retries:0,fetchImpl:async()=>{requests++;return new Response('ok');}});
 await assert.rejects(http.get('https://www.indeed.com/jobs',{beforeRequest:async()=>{throw Object.assign(new Error('persisted cooldown'),{code:'PROVIDER_COOLDOWN'});}}),/persisted cooldown/);
 assert.equal(requests,0);assert.equal(http.metrics.requests,0);
});
