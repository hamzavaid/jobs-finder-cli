import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CacheManager} from '../src/cache.js';import {CollectionManager} from '../src/collection.js';
import {greenhouseProvider} from '../src/ats/greenhouse.js';import {normalizeOptions} from '../src/filters.js';
for(const warm of [false,true])test(`Greenhouse resolves employer independently of ${warm?'warm':'cold'} posting cache`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'company-cache-'));try{
  const cache=new CacheManager({root});let metadata=0,postings=0;
  await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:[{id:'example',status:'valid'}],cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(Date.now()+3600000).toISOString()});
  const http={json:async url=>{if(!url.includes('/jobs')){metadata++;return {name:'Example Incorporated'};}postings++;return {jobs:[{id:123,title:'Chef',content:'Prepare meals',absolute_url:'https://employer.example/jobs/123'}]};}};
  const manager=new CollectionManager({cache,http}),base=normalizeOptions({website:'Greenhouse',search:'Chef'});
  if(warm)await manager.find(greenhouseProvider,base);
  const result=await manager.find(greenhouseProvider,{...base,company:'Example Incorporated'});
  assert.equal(result.jobs.length,1);assert.equal(metadata,1);assert.equal(postings,1);
  assert.equal(result.jobs[0].companyEvidence,'observed');assert.equal((await cache.read('inventory','Greenhouse')).data.boards[0].company,'Example Incorporated');
  const stored=await cache.read('postings','Greenhouse:global:example');assert.equal(stored.data.jobs[0].company,'Example Incorporated');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('observed posting employers do not require redundant board metadata requests',async()=>{
 const root=await mkdtemp(join(tmpdir(),'company-observed-'));try{
  const cache=new CacheManager({root});await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:[{id:'example',status:'valid'}],cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(Date.now()+3600000).toISOString()});let metadata=0;
  const http={json:async url=>{if(!url.includes('/jobs')){metadata++;return {name:'Kitchen'};}return {jobs:[{id:1,title:'Chef',company_name:'Kitchen',content:'Prepare meals',absolute_url:'https://employer.example/jobs/1'}]};}};
  const manager=new CollectionManager({cache,http});for(const search of ['Chef','Prepare'])assert.equal((await manager.find(greenhouseProvider,normalizeOptions({website:'Greenhouse',search,company:'Kitchen'}))).jobs.length,1);
  assert.equal(metadata,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bounded employer resolution reports partial coverage and cached repeats do not advance it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'company-budget-'));try{
  const cache=new CacheManager({root});await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:['example','second'].map(id=>({id,status:'valid'})),cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(Date.now()+3600000).toISOString()});let metadata=0,postings=0;
  const http={json:async url=>{if(!url.includes('/jobs')){metadata++;return {name:'Kitchen'};}postings++;return {jobs:[{id:1,title:'Chef',content:'Prepare meals',absolute_url:`https://employer.example/${postings}/1`}]};}};
  const base=normalizeOptions({website:'Greenhouse',search:'Chef'});await new CollectionManager({cache,http,maxBoards:2}).find(greenhouseProvider,base);
  const manager=new CollectionManager({cache,http,maxBoards:1}),options={...base,company:'Kitchen'},first=await manager.find(greenhouseProvider,options);
  assert.equal(first.jobs.length,1);assert.equal(first.stats.complete,false);assert.equal(first.stats.employerMetadataUnresolved,1);assert.match(first.stats.errors.join(' '),/company coverage is partial/);assert.equal(postings,2);assert.equal(metadata,1);
  assert.equal((await manager.find(greenhouseProvider,options)).stats.exactCacheHit,true);assert.equal(metadata,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
