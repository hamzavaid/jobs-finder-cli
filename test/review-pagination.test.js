import test from 'node:test';
import assert from 'node:assert/strict';
import {leverProvider} from '../src/ats/lever.js';
import {smartRecruitersProvider} from '../src/ats/smartrecruiters.js';
import {himalayasProvider} from '../src/sources/feeds.js';

for (const provider of [leverProvider,smartRecruitersProvider,himalayasProvider]) {
  const jobs=Array.from({length:100},(_,i)=>({id:String(i+1),text:'Chef',name:'Chef',title:'Chef',companyName:'Kitchen',company:{name:'Kitchen'},hostedUrl:`https://jobs.lever.co/example/${i+1}`,guid:`https://himalayas.app/jobs/${i+1}`}));
  const first=provider===leverProvider?jobs:provider===smartRecruitersProvider?{content:jobs,totalFound:200}:{jobs,totalCount:200};
  test(`${provider.name}: malformed later page retains verified jobs and reports partial coverage`,async()=>{
    let calls=0;
    const result=await provider.fetchBoard({id:'example'},{json:async()=>++calls===1?first:{schemaChanged:true}},{search:'Chef',pages:3});
    assert.equal(result.jobs.length,100);assert.equal(result.complete,false);assert.equal(result.pages,1);
    assert.match(result.reason,/invalid|schema|array/i);assert.equal(calls,2);
  });
  test(`${provider.name}: malformed first page is an error rather than empty success`,async()=>{
    await assert.rejects(provider.fetchBoard({id:'example'},{json:async()=>({schemaChanged:true})},{search:'Chef'}),/invalid|schema|array/i);
  });
}
