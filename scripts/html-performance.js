/** Offline CLI benchmark: separate Node processes, shared temporary disk cache. */
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'jobs-html-benchmark-'));
const bootstrap=`
import {readFile} from 'node:fs/promises';
let requests=0;
globalThis.fetch=async url=>{requests++;return new Response(url.endsWith('/robots.txt')?'User-agent: *\\nAllow: /':await readFile('test/fixtures/indeed-dom.html','utf8'));};
const {runCli}=await import('./src/cli.js');
await runCli(['node','jobs','find','--search','chef','--website','Indeed','--pages','1','--delay','750','--format','json']);
console.error('BENCH_REQUESTS='+requests);
`;
try {
 const samples=[];
 for(let index=0;index<6;index++) {
  const started=performance.now();
  const result=spawnSync(process.execPath,['--input-type=module','-e',bootstrap],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,JOBS_CACHE_DIR:root},encoding:'utf8',timeout:20000});
  if(result.error||result.status!==0)throw result.error||new Error(result.stderr);
  const requests=Number(/BENCH_REQUESTS=(\d+)/.exec(result.stderr)?.[1]);
  if(!Number.isFinite(requests))throw new Error('Missing benchmark request count.');
  samples.push({elapsedMs:Math.round(performance.now()-started),requests,jobs:JSON.parse(result.stdout).length,cacheHit:/Cache: exact-search hit \(Indeed\)/.test(result.stderr)});
 }
 const durations=samples.slice(1).map(sample=>sample.elapsedMs).sort((a,b)=>a-b);
 console.log(JSON.stringify({mode:'offline-synthetic-cli',cold:samples[0],warm:samples.slice(1),warmP50Ms:durations[2],warmP95Ms:durations[4]},null,2));
}finally {await rm(root,{recursive:true,force:true});}
