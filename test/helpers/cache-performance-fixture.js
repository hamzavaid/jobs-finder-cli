import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {CacheManager,CACHE_TTL} from '../../src/cache.js';
import {postingRevision} from '../../src/collection.js';
import {normalizeGreenhouse} from '../../src/ats/greenhouse.js';
import {PARSER_VERSION} from '../../src/schema.js';

export const fixtureBootstrap=String.raw`
import timers from 'node:timers/promises';
import {syncBuiltinESMExports} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
let offset=Number(await readFile(process.env.FIXTURE_CLOCK,'utf8').catch(()=>0));
const realNow=Date.now;Date.now=()=>realNow()+offset;
// Advance a virtual service clock for polite backoff/delay waits. No real network
// is used; process startup, filesystem, parsing/filtering and cache validation are timed.
timers.setTimeout=async ms=>{offset+=ms;await new Promise(resolve=>setImmediate(resolve));};syncBuiltinESMExports();
let requests=0,bulk=0,details=0;
globalThis.fetch=async(value,init={})=>{
 requests++;if(process.env.FIXTURE_NO_NETWORK)throw new Error('Warm search made an unexpected request');
 const url=new URL(value);
 if(url.hostname==='raw.githubusercontent.com')return new Response('');
 if(url.hostname!=='boards-api.greenhouse.io')return new Response('archive unavailable',{status:503});
 if(init.method==='HEAD')return new Response(null,{status:200});
 const parts=url.pathname.split('/'),tenant=decodeURIComponent(parts[3]);
 const index=Number(tenant.replace('board',''));
 const raw=i=>({id:100000+index*1000+i,title:i===0?'Software Engineer':'Software Specialist',company_name:'Employer '+tenant,absolute_url:'https://example.com/'+tenant+'/jobs/'+(100000+index*1000+i)});
 if(parts.length>5){details++;return new Response(JSON.stringify({...raw(Number(parts[5])-(100000+index*1000)),content:'Software Engineer duties.'}));}
 if(url.searchParams.get('content')==='true'){
  bulk++;if(index===0)return new Response('',{headers:{'content-length':String(16*1024*1024+1)}});
  return new Response(JSON.stringify({jobs:Array.from({length:32},(_,i)=>({...raw(i),content:'Software Engineer duties.'}))}));
 }
 return new Response(JSON.stringify({jobs:Array.from({length:32},(_,i)=>raw(i))}));
};
const {runCli}=await import(process.env.FIXTURE_CLI || './src/cli.js');
await runCli(['node','jobs',...process.argv.slice(1)]);
await writeFile(process.env.FIXTURE_CLOCK,String(offset));
process.stderr.write('FIXTURE_METRICS='+JSON.stringify({requests,bulk,details})+'\n');
`;

export async function runCachePerformance({cliModule,keep=false}={}) {
 const root=await mkdtemp(join(tmpdir(),'jobs-130-board-'));
 try {
  const now=Date.now(),observed=new Date(now-2*3600000).toISOString(),cache=new CacheManager({root});
  const boards=Array.from({length:130},(_,index)=>({id:'board'+String(index).padStart(3,'0'),region:'global',status:'valid',lastJobFetchAt:observed,lastValidatedAt:new Date(now).toISOString()}));
  for(const [index,board] of boards.entries()){
   const jobs=Array.from({length:32},(_,i)=>({...normalizeGreenhouse({id:100000+index*1000+i,title:i===0?'Software Engineer':'Software Specialist',company_name:'Employer '+board.id,absolute_url:'https://example.com/'+board.id+'/jobs/'+(100000+index*1000+i)},board),lastObservedAt:observed,lastSeenAt:observed}));
   await cache.put('postings','Greenhouse:global:'+board.id,{provider:'Greenhouse',board,jobs,parserVersion:PARSER_VERSION,lastSuccessfulFetchAt:observed,complete:true,content:false,pages:1,revision:postingRevision(jobs)},{ttl:-1000});
  }
  await cache.put('inventory','Greenhouse',{provider:'Greenhouse',boards,cursors:{},lastFullAt:null,nextDiscoveryAt:null,coverageComplete:false});
  const args=['find','--search','Software Engineer','--website','Greenhouse','--format','json'];
  const run=warm=>{const started=performance.now();const result=spawnSync(process.execPath,['--input-type=module','-e',fixtureBootstrap,...args],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,JOBS_CACHE_DIR:root,FIXTURE_CLOCK:join(root,'clock'),...(cliModule?{FIXTURE_CLI:cliModule}:{}),...(warm?{FIXTURE_NO_NETWORK:'1'}:{})},timeout:120000,maxBuffer:10*1024*1024});
   const metrics=JSON.parse(result.stderr?.match(/FIXTURE_METRICS=(\{[^\n]+\})/)?.[1]||'{}');
   return {...result,elapsedMs:performance.now()-started,metrics,jobs:result.status===0?JSON.parse(result.stdout):[]};};
  const cold=run(false),warm=run(!cliModule);
  return {root,boards:130,postings:4160,cold,warm};
 }finally{if(!keep)await rm(root,{recursive:true,force:true});}
}
