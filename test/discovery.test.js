import test from 'node:test';
import assert from 'node:assert/strict';
import {extractBoard,parseCdx,validateBoard,DiscoveryManager,makeCdxUrl} from '../src/discovery.js';
import {greenhouseProvider as gh} from '../src/ats/greenhouse.js';
import {leverProvider} from '../src/ats/lever.js';
const memory = () => {const store = new Map();return {read:async (k,id) => store.get(k+id),update:async (k,id,fn) => {const value = {data:fn(store.get(k+id)?.data)};store.set(k+id,value);return value;}};};
test('archive extraction decodes only safe board segments and retains EU identity', () => {
  assert.equal(extractBoard('https://boards.greenhouse.io/A1%20Garage/jobs/123',gh).id,'A1 Garage');
  assert.equal(extractBoard('https://boards.greenhouse.io/C%2B%2B%20Labs/jobs/123',gh).id,'C++ Labs');
  assert.equal(extractBoard('https://job-boards.greenhouse.io/embed/job_board?for=example',gh).id,'example');
  assert.equal(extractBoard('https://jobs.eu.lever.co/example/123',leverProvider).region,'eu');
  for (const value of ['https://evil.example/example','http://127.0.0.1/example','https://boards.greenhouse.io/a%2Fb/jobs/1','https://boards.greenhouse.io/%252e%252e','https://boards.greenhouse.io/static/app.js','https://boards.greenhouse.io/foo.js']) assert.equal(extractBoard(value,gh),null);
});
test('CDX JSON header/resume handling, malformed responses and safe query construction', () => {
  const parsed = parseCdx(JSON.stringify([['original'],['https://boards.greenhouse.io/a'],[],['cursor%20next']]));
  assert.equal(parsed.urls.length,1); assert.equal(parsed.resumeKey,'cursor%20next');
  assert.equal(parseCdx('[["original"],["https://boards.greenhouse.io/a"]]\n\nnext-key').resumeKey,'next-key');
  assert.throws(() => parseCdx('<h1>Access denied</h1>'));
  assert.throws(() => parseCdx('[ ["wrong"] ]'));
  assert.equal(new URL(makeCdxUrl('jobs.lever.co',{resumeKey:'a&evil=1'})).searchParams.get('resumeKey'),'a&evil=1');
});
test('HEAD validation falls back safely and distinguishes invalid boards from transient failures', async () => {
  assert.equal((await validateBoard(gh,{id:'example'},{head:async () => ({status:200})})).status,'valid');
  assert.equal((await validateBoard(gh,{id:'example'},{head:async () => {throw Object.assign(new Error('405'),{status:405});},json:async () => ({jobs:[]})})).method,'GET');
  for (const status of [403,429,500]) assert.equal((await validateBoard(gh,{id:'example'},{head:async () => {throw Object.assign(new Error('temporary'),{status});}})).status,'temporary-error');
  assert.equal((await validateBoard(gh,{id:'example'},{head:async () => {throw Object.assign(new Error('404'),{status:404});},json:async () => {throw Object.assign(new Error('404'),{status:404});}})).status,'invalid');
});
test('discovery resumes pages, deduplicates domains and skips archive access on cached inventory', async () => {
  const cache = memory(), calls = [];
  const http = {text:async url => {calls.push(url);const u = new URL(url);return JSON.stringify([['original'],[`https://${u.searchParams.get('url').split('/')[0]}/Example/jobs/1`],...(u.searchParams.has('resumeKey') ? [] : [[],['next']])]);},head:async () => ({status:200})};
  const manager = new DiscoveryManager({cache,http,maxPages:2,fallback:false});
  const first = await manager.ensure(gh);
  assert.equal(first.inventory.boards.length,1); assert.equal(first.inventory.boards[0].status,'valid'); assert.equal(calls.length,4);
  await manager.ensure(gh); assert.equal(calls.length,4);
});
test('archive outage never discards a previously valid board', async () => {
  const cache = memory();
  await cache.update('inventory','Greenhouse',() => ({provider:'Greenhouse',boards:[{id:'example',region:'global',status:'valid',lastValidatedAt:new Date().toISOString()}],cursors:{}}));
  const result = await new DiscoveryManager({cache,fallback:false,http:{text:async () => {throw new Error('HTTP 503');}}}).ensure(gh);
  assert.equal(result.inventory.boards[0].status,'valid'); assert.equal(result.errors.length,2);
});

test('an anonymous public scan index can recover cold discovery when both archive services fail', async () => {
  const cache = memory();
  const manager = new DiscoveryManager({cache,http:{
    text:async () => {throw new Error('index unavailable');},head:async () => ({status:200}),
    json:async url => {if (url.includes('commoncrawl')) throw new Error('archive unavailable');return {results:[{page:{url:'https://boards.greenhouse.io/fresh-board/jobs/123'}},{page:{url:'https://127.0.0.1/evil'}}]};}
  }});
  const result = await manager.ensure(gh);
  assert.equal(result.inventory.boards.length,1);assert.equal(result.inventory.boards[0].status,'valid');assert.equal(result.inventory.boards[0].discoveredBy,'urlscan-public');assert.equal(result.complete,false);
});

test('Common Crawl fallback accepts only its documented index host and consumes JSONL pages', async () => {
  const cache = memory();
  const http = {text:async url => url.includes('commoncrawl') ? '{"url":"https://boards.greenhouse.io/example/jobs/1"}\n' : Promise.reject(new Error('Wayback unavailable')),
    json:async () => [{id:'CC-MAIN-2026-43','cdx-api':'https://index.commoncrawl.org/CC-MAIN-2026-43-index'}],head:async () => ({status:200})};
  const result = await new DiscoveryManager({cache,http}).ensure(gh);
  assert.equal(result.inventory.boards[0].discoveredBy,'commoncrawl');
  const manager = new DiscoveryManager({cache,http:{json:async () => [{'cdx-api':'https://127.0.0.1/private'}]}});
  await assert.rejects(manager.commonCrawl(gh,new Map(),{cursors:{}}),/Untrusted/);
});
