import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const bootstrap = `
let requests = 0;
globalThis.fetch = async (value,init) => {
  requests++;
  if (process.env.MOCK_NO_NETWORK) throw new Error('Repeat search unexpectedly requested network');
  const url = new URL(value);
  if (url.hostname === 'web.archive.org') return new Response(JSON.stringify([['original'],['https://' + url.searchParams.get('url').split('/')[0] + '/example/jobs/123']]));
  if (init.method === 'HEAD') return new Response(null,{status:200});
  if (url.hostname === 'boards-api.greenhouse.io') return new Response(JSON.stringify({jobs:[{id:123,title:'Pastry Chef',location:{name:'Boston'},absolute_url:'https://example.com/jobs/12345'}]}));
  if (url.hostname.endsWith('lever.co')) return new Response(JSON.stringify([{id:'lever-id',text:'Pastry Chef',categories:{location:'Boston'},hostedUrl:'https://jobs.lever.co/example/lever-id'}]));
  if (url.hostname === 'api.ashbyhq.com') return new Response(JSON.stringify({jobs:[{id:'ashby-id',title:'Pastry Chef',isListed:true,jobUrl:'https://jobs.ashbyhq.com/example/ashby-id'}]}));
  throw new Error('Unexpected host ' + url.hostname);
};
const {runCli} = await import('./src/cli.js');
await runCli(['node','jobs',...process.argv.slice(1)]);
process.stderr.write('MOCK_HTTP=' + requests + '\\n');
`;
test('jobs find runs all three ATS providers from a cold install and reuses caches in another process', async t => {
  const root = await mkdtemp(join(tmpdir(),'ats-cli-'));
  const args = ['find','--search','Chef','--website','Greenhouse','Lever','Ashby','--format','json','--pages','1','--delay','750'];
  try {
    const run = env => spawnSync(process.execPath,['--input-type=module','-e',bootstrap,...args],{encoding:'utf8',env:{...process.env,JOBS_CACHE_DIR:root,...env},timeout:30000});
    let started = performance.now();const first = run({});const coldMs = Math.round(performance.now() - started);
    assert.equal(first.status,0,first.stderr);assert.equal(new Set(JSON.parse(first.stdout).map(job => job.source)).size,3);assert.ok(!first.stderr.includes('\x1b'));
    started = performance.now();const second = run({MOCK_NO_NETWORK:'1'});const warmMs = Math.round(performance.now() - started);
    assert.equal(second.status,0,second.stderr);assert.match(second.stderr,/MOCK_HTTP=0/);assert.deepEqual(JSON.parse(second.stdout),JSON.parse(first.stdout));
    t.diagnostic(`Fixture CLI timing (includes process startup and polite delays): cold=${coldMs}ms; warm=${warmMs}ms; warm HTTP requests=0.`);
  } finally {await rm(root,{recursive:true,force:true});}
});
