import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient,assertApiUrl,retryAfterMs} from '../src/api-http.js';
import {RequestScheduler} from '../src/concurrency.js';
const url = 'https://api.lever.co/v0/postings/example?mode=json';
test('API transport accepts only fixed HTTPS API/index routes and forbids redirects', async () => {
  for (const value of ['http://api.lever.co/v0/postings/example','https://127.0.0.1/x','https://api.lever.co.evil.example/v0/postings/example','https://api.lever.co/other','https://user:pass@api.lever.co/v0/postings/example','https://api.lever.co/v0/postings/a%2fb']) assert.throws(() => assertApiUrl(value));
  let init;
  const client = createApiClient({delayMs:0,fetchImpl:async (_,options) => {init = options;return new Response('[]');}});
  assert.deepEqual(await client.json(url),[]);assert.equal(init.redirect,'error');
  await assert.rejects(client.request(url,{method:'POST'}),/GET and HEAD only/);
});
test('API retry backoff honors Retry-After seconds and HTTP dates; 403/404 never retry', async () => {
  let calls = 0,clock = Date.now();const waits = [];
  const client = createApiClient({delayMs:0,now:() => clock,random:() => 0,sleep:async ms => {waits.push(ms);clock += ms;},fetchImpl:async () => ++calls === 1 ? new Response('',{status:429,headers:{'Retry-After':'2'}}) : new Response('[]')});
  assert.deepEqual(await client.json(url),[]);assert.equal(calls,2);assert.ok(waits[0] >= 2000);
  assert.equal(retryAfterMs(new Date(clock + 10000).toUTCString(),clock) > 9000,true);
  for (const status of [403,404]) {
    let count = 0;
    const blocked = createApiClient({delayMs:0,fetchImpl:async () => {count++;return new Response('',{status});}});
    await assert.rejects(blocked.json(url),error => error.status === status);assert.equal(count,1);
  }
});
test('API requests bound errors, timeouts, body sizes and retries without retrying invalid JSON', async () => {
  let attempts = 0;
  const server = createApiClient({delayMs:0,sleep:async () => {},fetchImpl:async () => {attempts++;return new Response('',{status:500});}});
  await assert.rejects(server.json(url),error => error.status === 500);assert.equal(attempts,3);
  const timeout = createApiClient({timeoutMs:10,retries:0,fetchImpl:() => new Promise(() => {})});
  await assert.rejects(timeout.json(url),/timed out/);
  const oversized = createApiClient({maxBytes:2,fetchImpl:async () => new Response('12345')});
  await assert.rejects(oversized.text(url),/size limit/);
  const invalid = createApiClient({fetchImpl:async () => new Response('<html>wrong</html>')});
  await assert.rejects(invalid.json(url),/invalid JSON/);
});
test('global and per-host concurrency limits hold and cancellation rejects queued requests', async () => {
  const controller = new AbortController(),scheduler = new RequestScheduler({concurrency:3,perHost:2,signal:controller.signal});
  let active = 0,maximum = 0;
  const counts = new Map();
  await Promise.all(Array.from({length:12},(_,index) => scheduler.run(`host-${index % 2}`,async () => {
    active++;maximum = Math.max(maximum,active);const host = `host-${index % 2}`;counts.set(host,(counts.get(host) || 0) + 1);assert.ok(counts.get(host) <= 2);
    await new Promise(resolve => setTimeout(resolve,2));active--;counts.set(host,counts.get(host) - 1);
  })));
  assert.equal(maximum,3);
  const client = createApiClient({signal:controller.signal,timeoutMs:1000,delayMs:0,fetchImpl:async (_,init) => new Promise((_,reject) => init.signal.addEventListener('abort',() => reject(init.signal.reason),{once:true}))});
  const pending = Array.from({length:10},() => client.json(url));
  setTimeout(() => controller.abort(),10);
  const results = await Promise.allSettled(pending);assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
});

test('a newly received Retry-After also delays requests already waiting in the host queue', async () => {
  const starts = [];
  const client = createApiClient({delayMs:5,retries:0,fetchImpl:async () => {
    starts.push(Date.now());return starts.length === 1 ? new Response('',{status:429,headers:{'Retry-After':'0.04'}}) : new Response('[]');
  }});
  const outcomes = await Promise.allSettled([client.json(url),client.json(url)]);
  assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');
  assert.ok(starts[1] - starts[0] >= 35,'queued request started before the provider cooldown');
});
