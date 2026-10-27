import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CacheManager,defaultCacheDir,stableKey,CACHE_TTL} from '../src/cache.js';
const inventory = () => ({provider:'Lever',boards:[],cursors:{}});
async function temporary(fn) {const root = await mkdtemp(join(tmpdir(),'jobs-cache-'));try {await fn(root);} finally {await rm(root,{recursive:true,force:true});}}
test('cache uses OS locations and stable keys ignore object property order', () => {
  assert.match(defaultCacheDir({},'win32','user'),/jobs-finder-cli/);
  assert.match(defaultCacheDir({},'darwin','user'),/Library/);
  assert.match(defaultCacheDir({},'linux','user'),/\.cache/);
  assert.equal(stableKey({b:2,a:1}),stableKey({a:1,b:2}));
});
test('cache freshness and stale fallback have independent deadlines', async () => temporary(async root => {
  let now = Date.now(); const cache = new CacheManager({root,now:() => now});
  const record = await cache.put('inventory','Lever',inventory(),{ttl:100});
  assert.equal(cache.fresh(record),true); now += 101; assert.equal(cache.fresh(record),false); assert.equal(cache.usableStale(record),true);
  now += CACHE_TTL.stale; assert.equal(cache.usableStale(record),false);
}));
test('cache recovers corrupt/versioned input automatically and writes atomically', async () => temporary(async root => {
  const warnings = [],cache = new CacheManager({root,onWarning:text => warnings.push(text)});
  await cache.put('inventory','Lever',inventory());
  await writeFile(cache.path('inventory','Lever'),'{broken');
  assert.equal(await cache.read('inventory','Lever'),null);
  assert.equal(warnings.length,1);
  await cache.put('inventory','Lever',inventory());
  assert.ok((await readdir(join(root,'inventory'))).some(name => name.includes('.corrupt-')));
  assert.ok(!(await readdir(join(root,'inventory'))).some(name => name.includes('.tmp-') || name.endsWith('.lock')));
  assert.equal(JSON.parse(await readFile(cache.path('inventory','Lever'),'utf8')).version,1);
}));
test('separate cache instances serialize read-modify-write without losing updates', async () => temporary(async root => {
  const a = new CacheManager({root}),b = new CacheManager({root});
  await Promise.all([a.update('inventory','Lever',data => ({...(data || inventory()),one:true})),b.update('inventory','Lever',data => ({...(data || inventory()),two:true}))]);
  const data = (await a.read('inventory','Lever')).data;
  assert.equal(data.one,true); assert.equal(data.two,true);
}));
test('cancellation preserves complete writes and rejects work waiting for a lock', async () => temporary(async root => {
  const controller = new AbortController(),cache = new CacheManager({root,signal:controller.signal});
  await cache.put('inventory','Lever',inventory());
  await writeFile(cache.path('inventory','Lever') + '.lock','active');
  const pending = cache.put('inventory','Lever',inventory());
  setTimeout(() => controller.abort(),20);
  await assert.rejects(pending,{name:'AbortError'});
  assert.ok(JSON.parse(await readFile(cache.path('inventory','Lever'),'utf8')).data);
}));
test('obsolete search records are pruned but discovery inventories survive', async () => temporary(async root => {
  const cache = new CacheManager({root});
  await cache.put('inventory','Lever',inventory());
  await cache.put('search','query',{jobs:[],refs:[],inventoryFingerprint:'abc',stats:{errors:[]}},{ttl:100});
  const old = new Date(Date.now() - 3 * 86400000);
  for (const kind of ['inventory','search']) await utimes(cache.path(kind,kind === 'inventory' ? 'Lever' : 'query'),old,old);
  await cache.prune();
  assert.ok(await cache.read('inventory','Lever')); assert.equal(await cache.read('search','query'),null);
}));

test('cache automatically recovers old dead-owner locks and interrupted recovery guards', async () => temporary(async root => {
  const cache = new CacheManager({root});await cache.put('inventory','Lever',inventory());
  const lock = cache.path('inventory','Lever') + '.lock';
  for (const path of [lock,lock + '.recovery']) {
    await writeFile(path,'{interrupted');const old = new Date(Date.now() - 600000);await utimes(path,old,old);
  }
  await cache.put('inventory','Lever',{...inventory(),recovered:true});
  assert.equal((await cache.read('inventory','Lever')).data.recovered,true);
  assert.ok(!(await readdir(join(root,'inventory'))).some(name => name.includes('.lock')));
}));
