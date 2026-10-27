import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CacheManager,CACHE_TTL} from '../src/cache.js';
import {CollectionManager} from '../src/collection.js';
import {ashbyProvider} from '../src/ats/ashby.js';
import {normalizeOptions} from '../src/filters.js';
import {identifyCrossSourceDuplicates} from '../src/dedup.js';
const options = () => normalizeOptions({search:'chef',website:'Ashby'});
async function context(fn) {
  const root = await mkdtemp(join(tmpdir(),'ats-recovery-'));
  let now = Date.now(),fail = false,calls = 0;
  const cache = new CacheManager({root,now:() => now});
  const http = {head:async () => ({status:200}),text:async () => JSON.stringify([['original'],['https://jobs.ashbyhq.com/example/job']]),json:async () => {
    calls++;if (fail) throw Object.assign(new Error('rate limited'),{status:429});
    return {jobs:[{id:'12345',isListed:true,title:'Chef',jobUrl:'https://jobs.ashbyhq.com/example/12345'}]};
  }};
  const manager = new CollectionManager({cache,http,now:() => now});
  try {await fn({cache,manager,advance:ms => {now += ms;},fail:() => {fail = true;},calls:() => calls});}
  finally {await rm(root,{recursive:true,force:true});}
}
test('failed refresh returns explicitly stale data and persists rate-limit backoff', async () => context(async ({cache,manager,advance,fail,calls}) => {
  await manager.find(ashbyProvider,options());advance(CACHE_TTL.postings + 1);fail();
  const result = await manager.find(ashbyProvider,options());
  assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].cacheStatus,'stale');assert.equal(result.stats.complete,false);
  const count = calls();await manager.find(ashbyProvider,options());assert.equal(calls(),count);
  assert.ok((await cache.read('inventory','Ashby')).data.providerRetryAt);
}));
test('old data beyond the stale retention limit is never returned as current', async () => context(async ({manager,advance,fail}) => {
  await manager.find(ashbyProvider,options());advance(CACHE_TTL.stale + 1);fail();
  await assert.rejects(manager.find(ashbyProvider,options()),/no board data could be collected/);
}));
test('an optional search-cache write failure does not discard collected jobs', async () => context(async ({cache,manager}) => {
  const original = cache.put.bind(cache);cache.put = (...args) => args[0] === 'search' ? Promise.reject(new Error('disk full')) : original(...args);
  const result = await manager.find(ashbyProvider,options());
  assert.equal(result.jobs.length,1);assert.ok(result.stats.errors.some(error => /cache write failed/.test(error)));
}));
test('cross-source duplicate hints require a specific identical URL and never merge requisitions', () => {
  const rows = [
    {source:'Greenhouse',id:'1',url:'https://company.example/jobs/12345?utm_source=x'},
    {source:'Lever',id:'2',url:'https://company.example/jobs/12345'},
    {source:'Ashby',id:'3',url:'https://company.example/jobs/12346'},
    {source:'Indeed',id:'4',url:'https://company.example/careers'}
  ];
  const result = identifyCrossSourceDuplicates(rows);
  assert.equal(result.jobs.length,4);assert.equal(result.possible,1);assert.equal(result.jobs[1].possibleDuplicateOf,'Greenhouse:1');assert.equal(result.jobs[2].possibleDuplicateOf,undefined);
});
