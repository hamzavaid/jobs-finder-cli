import test from 'node:test';import assert from 'node:assert/strict';import {canonicalizeUrl,isPublicAddress,createPublicHttp} from '../src/public-http.js';import {parsePosting} from '../src/posting-parser.js';import {PostingResolver} from '../src/resolution.js';import {githubProvider} from '../src/sources/github.js';
const html='<script type="application/ld+json">{"@type":"JobPosting","title":"Nurse","hiringOrganization":{"name":"Hospital"},"description":"Care duties","datePosted":"2026-10-01"}</script>';
const cache={read:async()=>null,fresh:()=>false,put:async()=>{}};
test('canonical URLs preserve job identity and reject private addresses and credentials',()=>{
 assert.equal(canonicalizeUrl('https://example.com/job?id=1&utm_source=x#fragment'),'https://example.com/job?id=1');
 for(const url of ['http://example.com','https://user@example.com','https://127.0.0.1','https://[::1]','https://[::ffff:127.0.0.1]','https://localhost','https://192.168.1.1'])assert.throws(()=>canonicalizeUrl(url));
 for(const ip of ['10.0.0.1','169.254.169.254','100.64.0.1','2001:db8::1','::ffff:8.8.8.8'])assert.equal(isPublicAddress(ip),false);
 assert.equal(isPublicAddress('8.8.8.8'),true);
});
test('resolver checks robots, parses authoritative metadata, and distinguishes incomplete or unsupported',async()=>{
 let calls=0;const http={get:async(url)=>{calls++;return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':html;}};
 const resolver=new PostingResolver({http,cache});const result=await resolver.resolve('https://employer.example/job/1?utm_source=github');assert.equal(result.status,'complete');assert.equal(result.job.company,'Hospital');assert.equal(calls,2);
 assert.equal(parsePosting('<h1>Search snippet</h1>','https://example.com/1').status,'unsupported');
 const blocked=new PostingResolver({http:{get:async()=> 'User-agent: *\nDisallow: /'},cache});assert.equal((await blocked.resolve('https://example.com/job')).status,'blocked');
});
test('generic transport rejects rebinding/private DNS at connection time',async()=>{
 const http=createPublicHttp({lookup:(host,options,cb)=>cb(null,[{address:'127.0.0.1',family:4}])});await assert.rejects(http.get('https://safe-looking.example/job'),/Private or reserved DNS/);
});
test('GitHub list adapter accepts only resolved complete postings and preserves provenance',async()=>{
 const result=await githubProvider.fetchBoard({}, {publicLists:async()=>({documents:[{url:'https://github.com/list',body:'| Employer | Chef | Boston | [apply](https://employer.example/jobs/1) | 1d |'}],errors:[]})},{resolver:{resolve:async()=>({status:'complete',job:{source:'Employer',id:'1',title:'Chef',company:'Kitchen',url:'https://employer.example/jobs/1',description:'Prepare meals'}})}});
 assert.equal(result.jobs[0].source,'GitHub');assert.equal(result.jobs[0].authoritativeSource,'Employer');assert.equal(result.complete,false);
});
test('resolver does not follow an unrelated ATS link after conflicting posting metadata',async()=>{
 let requests=0;
 const resolver=new PostingResolver({cache,http:{get:async url=>{requests++;return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':'<script type="application/ld+json">{"@type":"JobPosting","url":"https://employer.example/jobs/other","title":"Wrong Chef"}</script><a href="https://jobs.lever.co/example/wrong">Apply</a>';}}});
 const result=await resolver.resolve('https://employer.example/jobs/requested');assert.equal(result.job,null);assert.equal(requests,2);
});
