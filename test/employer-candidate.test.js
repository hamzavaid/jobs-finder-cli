import test from 'node:test';import assert from 'node:assert/strict';import {extractPublicLinks,employerCandidate} from '../src/employer-candidate.js';import {DiscoveryManager} from '../src/discovery.js';import {greenhouseProvider} from '../src/ats/greenhouse.js';
test('HTML Markdown and sitemaps yield deduplicated leads without fabricated jobs',()=>{
 const links=extractPublicLinks('<a href="https://boards.greenhouse.io/example/jobs/1">Apply</a><loc>https://jobs.lever.co/demo/2</loc> [apply](https://boards.greenhouse.io/example/jobs/1) [bad](javascript:bad)');assert.equal(links.length,2);assert.equal(employerCandidate({provider:'Lever',id:'demo'}).tenant,'demo');
});
test('independent public lists discover and validate employers without archive success',async()=>{
 let stored;const cache={read:async()=>stored,update:async(k,id,fn)=>(stored={data:fn(stored?.data)})};
 const http={publicLists:async()=>({documents:[{url:'https://github.com/list',body:'[Apply](https://boards.greenhouse.io/example/jobs/1)'}],errors:[]}),text:async()=>{throw new Error('503');},json:async()=>{throw new Error('503');},head:async()=>({status:200})};
 const result=await new DiscoveryManager({cache,http,fallback:false}).ensure(greenhouseProvider);assert.equal(result.inventory.boards[0].status,'valid');assert.equal(result.inventory.boards[0].discoveryMethod,'github-public-list');assert.equal(result.complete,false);
});
