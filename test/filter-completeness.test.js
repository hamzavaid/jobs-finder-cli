import test from 'node:test';import assert from 'node:assert/strict';import {FilterEngine} from '../src/filter-engine.js';import {normalizeOptions} from '../src/filters.js';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {CacheManager} from '../src/cache.js';import {CollectionManager} from '../src/collection.js';import {greenhouseProvider} from '../src/ats/greenhouse.js';
test('ATS enrichment requirements include missing hard-filter evidence independently of description',()=>{
 const job={source:'Lever',title:'Chef',description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true};
 const engine=new FilterEngine(normalizeOptions({search:'Chef',website:'Lever',employment:'full-time'}));
 assert.equal(engine.evaluate(job).needsEnrichment,true);
 assert.equal(engine.evaluate({...job,employmentType:'Full-time'}).needsEnrichment,false);
 assert.equal(engine.evaluate({...job,employmentType:'Contract'}).needsEnrichment,false);
 const unsupported=new FilterEngine(normalizeOptions({search:'Chef',website:'Lever',under:'true'}));assert.equal(unsupported.evaluate(job).needsEnrichment,false);
});
test('complete ATS descriptions resolve missing employment selectively without repeating bulk content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'metadata-completeness-'));try{
  const cache=new CacheManager({root});await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards:[{id:'example',status:'valid'}],cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(Date.now()+3600000).toISOString()});
  const raw=id=>({id,title:'Chef',company_name:'Kitchen',content:'Prepare meals',absolute_url:`https://employer.example/jobs/${id}`});let bulk=0,details=0;
  const http={json:async url=>{if(url.includes('content=true'))bulk++;const id=/\/jobs\/(\d+)$/.exec(url)?.[1];if(id){details++;return {...raw(Number(id)),metadata:[{name:'employment type',value:'Full-time'}]};}return {jobs:Array.from({length:5},(_,i)=>raw(i+1))};}};
  const manager=new CollectionManager({cache,http}),options=normalizeOptions({search:'Chef',website:'Greenhouse',employment:'full-time'});
  const result=await manager.find(greenhouseProvider,options);assert.equal(result.jobs.length,5);assert.equal(details,5);assert.equal(bulk,0);
  assert.equal((await manager.find(greenhouseProvider,options)).stats.exactCacheHit,true);assert.equal(details,5);
 }finally{await rm(root,{recursive:true,force:true});}
});
