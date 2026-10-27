import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CacheManager} from '../src/cache.js';
import {CollectionManager} from '../src/collection.js';
import {greenhouseProvider} from '../src/ats/greenhouse.js';
import {ashbyProvider} from '../src/ats/ashby.js';
import {leverProvider} from '../src/ats/lever.js';
import {normalizeOptions} from '../src/filters.js';
import {findJobs} from '../src/search.js';

function fixtureApi() {
  const calls = [];
  return {calls,
    text:async value => {calls.push(value);const domain = new URL(value).searchParams.get('url').split('/')[0];return JSON.stringify([['original'],[`https://${domain}/example/jobs/123`]]);},
    head:async value => {calls.push(value);return {status:200};},
    json:async value => {
      calls.push(value);
      if (value.includes('greenhouse.io')) return {jobs:[{id:123,title:'Pastry Chef',location:{name:'Boston'},absolute_url:'https://example.com/jobs/123'}]};
      if (value.includes('lever.co')) return [{id:'lever-123',text:'Pastry Chef',categories:{location:'Boston',commitment:'Full-time'},hostedUrl:'https://jobs.lever.co/example/lever-123'}];
      return {jobs:[{id:'ashby-123',title:'Pastry Chef',isListed:true,workplaceType:'OnSite',employmentType:'FullTime',location:'Boston',jobUrl:'https://jobs.ashbyhq.com/example/ashby-123'}]};
    }
  };
}
async function temporary(fn) {const root = await mkdtemp(join(tmpdir(),'ats-pipeline-'));try {await fn(root);} finally {await rm(root,{recursive:true,force:true});}}
test('first run automatically discovers, validates, fetches and caches; repeat search makes zero requests', async () => temporary(async root => {
  const cache = new CacheManager({root}),http = fixtureApi(),manager = new CollectionManager({cache,http});
  const options = normalizeOptions({search:'chef',website:'Greenhouse'});
  const first = await manager.find(greenhouseProvider,options), count = http.calls.length;
  assert.equal(first.jobs.length,1); assert.ok(count >= 4); assert.equal(first.stats.complete,true);
  const second = await manager.find(greenhouseProvider,options);
  assert.equal(second.stats.exactCacheHit,true);assert.equal(http.calls.length,count);
  const different = await manager.find(greenhouseProvider,{...options,search:'accountant'});
  assert.equal(different.jobs.length,0);assert.equal(http.calls.length,count);
}));
test('underlying posting revision invalidates an exact-search cache', async () => temporary(async root => {
  const cache = new CacheManager({root}),http = fixtureApi(),manager = new CollectionManager({cache,http});
  const options = normalizeOptions({search:'chef',website:'Greenhouse'});
  await manager.find(greenhouseProvider,options);
  const record = await cache.read('postings','Greenhouse:global:example');
  await cache.put('postings','Greenhouse:global:example',{...record.data,revision:'changed',jobs:record.data.jobs.map(job => ({...job,title:'Accountant'}))},{ttl:60000});
  const result = await manager.find(greenhouseProvider,options);
  assert.equal(result.jobs.length,0);assert.notEqual(result.stats.exactCacheHit,true);
}));
test('all selected ATS providers use the shared orchestration without manual boards', async () => temporary(async root => {
  const cache = new CacheManager({root}),http = fixtureApi(),collection = new CollectionManager({cache,http});
  const result = await findJobs(normalizeOptions({search:'chef',website:['Greenhouse','Lever','Ashby']}),null,{collection});
  assert.deepEqual(result.jobs.map(job => job.source),['Greenhouse','Lever','Ashby','Lever']);
  assert.ok(result.jobs.every(job => job.title.includes('Chef')));
}));
test('HTML-only selection never calls ATS discovery or collection', async () => {
  const result = await findJobs(normalizeOptions({search:'chef',website:'LinkedIn'}),{get:async () => '<ul></ul>'},{collection:{find:async () => {throw new Error('ATS should not run');}}});
  assert.equal(result.jobs.length,0);
});
test('unsupported applicant/verification attributes never become ATS matches', async () => temporary(async root => {
  const collection = new CollectionManager({cache:new CacheManager({root}),http:fixtureApi()});
  for (const provider of [greenhouseProvider,leverProvider,ashbyProvider]) {
    const result = await collection.find(provider,normalizeOptions({search:'chef',website:provider.name,under:'true',verified:'false'}));
    assert.equal(result.jobs.length,0);assert.ok(result.stats.unknownExcluded > 0);
  }
}));

test('selected ATS providers execute concurrently while output order remains stable', async () => {
  let active = 0,maximum = 0;
  const collection = {cache:{flush:async () => {}},find:async provider => {
    active++;maximum = Math.max(maximum,active);
    await new Promise(resolve => setTimeout(resolve,provider.name === 'Greenhouse' ? 15 : 2));active--;
    return {jobs:[{source:provider.name,id:provider.name,title:'Chef'}],stats:{pages:1,cardsSeen:1,rejected:0,detailRequests:0,unknownExcluded:0,facetReliant:[],errors:[]}};
  }};
  const result = await findJobs(normalizeOptions({search:'chef',website:['Greenhouse','Lever','Ashby']}),null,{collection});
  assert.equal(maximum,3);assert.deepEqual(result.jobs.map(job => job.source),['Greenhouse','Lever','Ashby']);
});

test('bounded partial searches also get exact-cache hits without concealing partial coverage', async () => temporary(async root => {
  const cache = new CacheManager({root}),http = fixtureApi();
  http.text = async url => {http.calls.push(url);const domain = new URL(url).searchParams.get('url').split('/')[0];return JSON.stringify([['original'],...Array.from({length:4},(_,index) => [`https://${domain}/board${index}/jobs/123`])]);};
  const manager = new CollectionManager({cache,http,maxBoards:1}),options = normalizeOptions({search:'chef',website:'Greenhouse'});
  const first = await manager.find(greenhouseProvider,options),count = http.calls.length;
  assert.equal(first.stats.complete,false);assert.ok(first.stats.errors.some(error => /partial coverage/.test(error)));
  const second = await manager.find(greenhouseProvider,options);
  assert.equal(second.stats.exactCacheHit,true);assert.equal(second.stats.complete,false);assert.equal(http.calls.length,count);
}));
