import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Replace only fetch in an isolated process; exercise real CLI, HTTP, parsers and store.
const bootstrap = `
import {readFile} from 'node:fs/promises';
globalThis.fetch = async url => {
  const host = new URL(url).hostname;
  if (process.env.MOCK_BLOCK && host.includes(process.env.MOCK_BLOCK.toLowerCase())) return new Response('restricted',{status:403});
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\\nAllow: /');
  const file = host.includes('linkedin') ? (url.includes('/jobPosting/') ? 'detail.html' : 'search.html')
    : host.includes('indeed') ? 'indeed-mosaic.html' : 'glassdoor-dom.html';
  return new Response(await readFile('test/fixtures/' + file,'utf8'));
};
const {runCli} = await import('./src/cli.js');
await runCli(['node','jobs',...process.argv.slice(1)]);
`;
const cli = (args, env) => spawnSync(process.execPath,['--input-type=module','-e',bootstrap,...args],{encoding:'utf8',env:{...process.env,...env},timeout:30000});
test('find searches legacy providers, saves results, and keeps JSON stdout clean', async () => {
  const dir = await mkdtemp(join(tmpdir(),'jobs-e2e-')), path = join(dir,'db.json');
  try {
    const result = cli(['find','--website','LinkedIn','Indeed','Glassdoor','--search','chef','--pages','1','--limit','3','--delay','750','--format','json','--save'],{JOBS_DB:path});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).map(job => job.source),['LinkedIn','Indeed','Glassdoor']);
    assert.equal(Object.keys(JSON.parse(await readFile(path,'utf8')).jobs).length,3);
    assert.match(result.stderr,/Saved 3 jobs/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('find reports a blocked provider on stderr and retains other results', () => {
  const result = cli(['find','--website','LinkedIn','Glassdoor','--search','nurse','--pages','1','--delay','750','--format','jsonl'],{MOCK_BLOCK:'Glassdoor'});
  assert.equal(result.status,0,result.stderr); assert.match(result.stderr,/WARNING: Glassdoor/);
  assert.ok(result.stdout.trim().split('\n').map(JSON.parse).every(job => job.source === 'LinkedIn'));
});
test('doctor probe validates parsed cards and reports blocked access with failure exit', () => {
  const result = cli(['doctor','--probe','--website','Glassdoor'],{MOCK_BLOCK:'Glassdoor'});
  assert.equal(result.status,1,result.stderr);
  assert.equal(JSON.parse(result.stdout).onlineProbe.Glassdoor.status,'error');
});
test('argument errors and all-provider failure are nonzero without success output', () => {
  for (const args of [
    ['find','--search','chef','--remote','yes','--workplace','hybrid'],
    ['find','--website','LinkedIn','Indeed','Glassdoor','--search','chef','--pages','21'],['find','--search','chef','--under','maybe'],
    ['find','--search','chef','--bogus'], ['find'],
    ['find','--search','chef','--website','Glassdoor','--format','json']
  ]) {
    const result = cli(args,{MOCK_BLOCK:'Glassdoor'});
    assert.equal(result.status,1,JSON.stringify(args)); assert.equal(result.stdout,'');
  }
});
