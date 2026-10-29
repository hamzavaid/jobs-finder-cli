import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CacheManager} from '../src/cache.js';
import {findIndeedJobs} from '../src/indeed.js';
import {findGlassdoorJobs} from '../src/glassdoor.js';
import {findJobs} from '../src/search.js';
import {normalizeOptions} from '../src/filters.js';
import {AccessError} from '../src/http.js';
import {HTML_TTL} from '../src/provider-access.js';
import {readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const options=extra=>normalizeOptions({search:'chef',website:'Indeed',pages:1,...extra});
const fixture=()=>readFile(new URL('./fixtures/indeed-dom.html',import.meta.url),'utf8');
async function temporary(work) {const root=await mkdtemp(join(tmpdir(),'html-pipeline-'));try {await work(root);}finally {await rm(root,{recursive:true,force:true});}}

test('Glassdoor policy is restricted before any request; other sources continue',async()=> {
 let calls=0;await assert.rejects(findGlassdoorJobs(options(),{get:async()=>{calls++;}}),error=>error.providerStatus==='restricted' && /browser/.test(error.message));assert.equal(calls,0);
 const page=await readFile(new URL('./fixtures/search.html',import.meta.url),'utf8');
 const result=await findJobs(options({website:['LinkedIn','Glassdoor']}),{get:async()=>page},{cache:false});
 assert.equal(result.stats.providers.Glassdoor.status,'restricted');assert.ok(result.jobs.every(job=>job.source==='LinkedIn'));
});
test('repeated HTML search reuses persistent results with zero requests and keeps observation times',async()=>temporary(async root=> {
 const page=await fixture();let calls=0;const http={get:async url=>{calls++;return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page;}};
 const first=await findIndeedJobs(options(),http,{cache:new CacheManager({root})});const before=calls;
 const second=await findIndeedJobs(options(),http,{cache:new CacheManager({root})});
 assert.equal(calls,before);assert.equal(second.stats.exactCacheHit,true);assert.deepEqual(second.jobs,first.jobs);
}));
test('blocks persist cooldown independently from results and all-blocked searches fail honestly',async()=>temporary(async root=> {
 let calls=0;const http={get:async url=>{calls++;if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';throw new AccessError('HTTP 403',403);}},cache=new CacheManager({root});
 await assert.rejects(findIndeedJobs(options(),http,{cache}),error=>error.providerStatus==='blocked');const before=calls;
 await assert.rejects(findIndeedJobs(options(),http,{cache:new CacheManager({root})}),error=>error.code==='PROVIDER_COOLDOWN');assert.equal(calls,before);
 await assert.rejects(findJobs(options({website:'Glassdoor'}),http),error=>error.providers.Glassdoor.status==='restricted');
}));
test('partial cache retains warnings; expiry with block serves only labeled bounded stale data',async()=>temporary(async root=> {
 let now=Date.now(),blocked=false;const page=await fixture()+'<a rel="next" href="/jobs?start=10">Next</a>',cache=new CacheManager({root,now:()=>now});
 const http={get:async url=>{if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';if(blocked)throw new AccessError('HTTP 403',403);return page;}};
 const first=await findIndeedJobs(options(),http,{cache,now:()=>now});assert.equal(first.stats.status,'partial');
 const second=await findIndeedJobs(options(),http,{cache,now:()=>now});assert.deepEqual(second.stats.errors,first.stats.errors);
 now+=HTML_TTL.partial+1;blocked=true;const stale=await findIndeedJobs(options(),http,{cache,now:()=>now});assert.equal(stale.stats.stale,true);assert.equal(stale.jobs[0].cacheStatus,'stale');assert.equal(stale.jobs[0].fetchedAt,first.jobs[0].fetchedAt);
 now+=HTML_TTL.stale;await assert.rejects(findIndeedJobs(options(),http,{cache,now:()=>now}));
}));
test('robots denial and unrecognized pages never become successful empty data',async()=> {
 await assert.rejects(findIndeedJobs(options(),{get:async()=> 'User-agent: *\nDisallow: /jobs'},{cache:false}),error=>error.providerStatus==='restricted');
 await assert.rejects(findIndeedJobs(options(),{get:async url=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':'<html>new schema</html>'},{cache:false}),error=>error.providerStatus==='schema_changed');
});

test('concurrent identical queries share collection and parser version or corruption forces refresh',async()=>temporary(async root=> {
 let calls=0;const page=await fixture(),http={get:async url=>{calls++;return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page;}};
 const [a,b]=await Promise.all([findIndeedJobs(options(),http,{cache:new CacheManager({root})}),findIndeedJobs(options(),http,{cache:new CacheManager({root})})]);
 assert.equal(calls,2);assert.ok(a.stats.exactCacheHit||b.stats.exactCacheHit);
 const path=join(root,'html-search',(await readdir(join(root,'html-search'))).find(name=>name.endsWith('.json')));
 const record=JSON.parse(await readFile(path,'utf8'));record.data.parserVersion--;
 await writeFile(path,JSON.stringify(record));await findIndeedJobs(options(),http,{cache:new CacheManager({root})});assert.equal(calls,3);
 await writeFile(path,'broken JSON');await findIndeedJobs(options(),http,{cache:new CacheManager({root})});assert.equal(calls,4);
 await findIndeedJobs(options({search:'nurse'}),http,{cache:new CacheManager({root})});assert.equal(calls,5);
}));
test('rolling dates are evaluated on exact cache hits without another request',async()=>temporary(async root=> {
 let now=Date.parse('2026-10-29T12:00:00Z'),calls=0;
 const page='<script>window._initialData={"results":[{"jk":"abcdef12345678","title":"Chef","company":"Bakery","datePosted":"2026-10-28T12:01:00Z"}]}</script>';
 const http={get:async url=>{calls++;return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page;}},cache=new CacheManager({root,now:()=>now});
 assert.equal((await findIndeedJobs(options({date:'1d'}),http,{cache,now:()=>now})).jobs.length,1);
 now+=120000;const result=await findIndeedJobs(options({date:'1d'}),http,{cache,now:()=>now});assert.equal(result.jobs.length,0);assert.equal(result.stats.exactCacheHit,true);assert.equal(calls,2);
}));
test('details are reused across queries and blocks stop detail work immediately',async()=>temporary(async root=> {
 let details=0,blocked=false;const page=await fixture(),cache=new CacheManager({root});
 const http={get:async url=>{if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';if(url.includes('/viewjob')){details++;if(blocked)throw new AccessError('HTTP 403',403);return '<div id="jobDescriptionText">Prepare food</div>';}return page;}};
 const first=await findIndeedJobs(options({details:true}),http,{cache});assert.equal(first.jobs[0].description,'Prepare food');
 const second=await findIndeedJobs(options({details:true,search:'pastry'}),http,{cache});assert.equal(details,1);assert.equal(second.stats.detailCacheHits,1);
 blocked=true;await assert.rejects(findIndeedJobs(options({details:true}),http,{cache:false}),error=>error.providerStatus==='blocked');assert.equal(details,2);
}));
test('later page denial, repeated links, unsafe pagination and cancellation preserve honest outcomes',async()=> {
 const page=await fixture(),next='<a rel="next" href="/jobs?start=10">Next</a>';let pages=0;
 const result=await findIndeedJobs(options({pages:3}),{get:async url=>{if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';if(pages++)throw new AccessError('HTTP 429',429);return page+next;}},{cache:false});
 assert.equal(result.stats.status,'partial');assert.equal(result.stats.stopStatus,'rate_limited');assert.equal(result.jobs.length,1);
 const repeated=await findIndeedJobs(options({pages:3}),{get:async url=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page+'<a rel="next" href="https://www.indeed.com/jobs?q=chef&amp;sort=date">Next</a>'},{cache:false});
 assert.equal(repeated.stats.pages,1);assert.match(repeated.stats.errors[0],/repeated pagination/);
 const unsafe=await findIndeedJobs(options({pages:3}),{get:async url=>{assert.ok(!url.includes('127.0.0.1'));return url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page+'<a rel="next" href="https://127.0.0.1/jobs">Next</a>';}},{cache:false});assert.equal(unsafe.stats.status,'partial');
 const controller=new AbortController();await assert.rejects(findIndeedJobs(options(),{get:async url=>{if(url.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';controller.abort();throw controller.signal.reason;}},{cache:false,signal:controller.signal}),{name:'AbortError'});
});
test('separate CLI processes keep structured stdout valid and warm searches make zero requests',()=> {
 const result=spawnSync(process.execPath,['scripts/html-performance.js'],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.cold.requests,2);assert.ok(report.warm.every(sample=>sample.requests===0&&sample.cacheHit&&sample.jobs===1));
});
test('unavailable cache directory preserves freshly parsed results with a warning',async()=>temporary(async root=> {
 const path=join(root,'file');await writeFile(path,'not a directory');const page=await fixture();
 const result=await findIndeedJobs(options(),{get:async url=>url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page},{cache:new CacheManager({root:path})});
 assert.equal(result.jobs.length,1);assert.match(result.stats.errors.join(' '),/cache unavailable/);
}));
test('periodic pruning expires HTML records but respects a longer Retry-After',async()=>temporary(async root=> {
 let now=Date.now();const cache=new CacheManager({root,now:()=>now});
 await cache.put('html-policy','expired',{body:'User-agent: *'},{ttl:1000});
 await cache.put('html-policy','active',{status:'rate_limited',retryAt:now+3*86400000},{ttl:3*86400000});
 now+=2*86400000;await cache.prune();assert.equal(await cache.read('html-policy','expired'),null);assert.ok(await cache.read('html-policy','active'));
}));
