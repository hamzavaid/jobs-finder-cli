import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeOptions} from '../src/filters.js';
import {findJobs} from '../src/search.js';
import {fetchProviderJob, postingProvider} from '../src/providers.js';
import {saveJobs} from '../src/store.js';
const fixture = name => readFile(new URL(`./fixtures/${name}`,import.meta.url),'utf8');
const cli = (args, env = {}) => spawnSync(process.execPath,['bin/jobs.js',...args],{encoding:'utf8',env:{...process.env,...env}});
test('actual CLI variadic/repeated/quoted/comma-separated provider arguments retain order and deduplicate', () => {
  for (const websites of [
    ['--website','"Glassdoor"'],
    ['--website','LinkedIn','Glassdoor'],
    ['--website','indeed','--website','GLASSDOOR','Indeed'],
    ['--website','LinkedIn,Glassdoor']
  ]) {
    // Shell removes quotes before argv; emulate that here.
    const args = websites.map(value => value.replaceAll('"',''));
    const result = cli(['url','--search','chef',...args]);
    assert.equal(result.status,0,result.stderr);
    const sites = normalizeOptions({search:'chef',website:args.filter(x => x !== '--website')}).websites;
    const urls = result.stdout.trim().split('\n');
    assert.equal(urls.length,sites.length);
    assert.ok(urls.some(url => url.includes('glassdoor.com')));
  }
  assert.equal(cli(['url','--search','chef','--website','invalid']).status,1);
  assert.equal(cli(['url','--search','chef','--website','']).status,1);
  assert.equal(cli(['url','--search','chef']).stdout.trim().split('\n').length,3);
});
test('single and three-provider searches globally rank source-qualified postings within total limit', async () => {
  const [li,indeed,glassdoor] = await Promise.all(['search.html','indeed-mosaic.html','glassdoor-dom.html'].map(fixture));
  const http = {get:async url => url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : url.includes('linkedin.com') ? li : url.includes('indeed.com') ? indeed : glassdoor};
  for (const site of ['LinkedIn','Indeed','Glassdoor']) {
    const result = await findJobs(normalizeOptions({search:'chef',website:site,pages:1}),http);
    assert.equal(result.jobs.length,2); assert.ok(result.jobs.every(job => job.source === site));
  }
  const result = await findJobs(normalizeOptions({search:'chef',limit:3,pages:1,website:['LinkedIn','Indeed','Glassdoor']}),http);
  assert.deepEqual(result.jobs.map(job => job.source),['Glassdoor','LinkedIn','LinkedIn']);
  assert.equal(result.stats.errors.length,0);
});
test('Glassdoor failure leaves other providers usable and all failures are explicit', async () => {
  const li = await fixture('search.html');
  const result = await findJobs(normalizeOptions({search:'chef',pages:1,website:['LinkedIn','Indeed','Glassdoor']}),{get:async url => {
    if (!url.includes('linkedin.com')) throw new Error('HTTP 403');
    return li;
  }});
  assert.equal(result.jobs.length,2); assert.equal(result.stats.errors.length,2);
  await assert.rejects(findJobs(normalizeOptions({search:'chef',website:['LinkedIn','Indeed','Glassdoor']}),{get:async () => {throw new Error('blocked');}}), /All selected sites failed/);
});
test('detail dispatch detects providers, rejects foreign URLs and conflicting options before network', async () => {
  assert.equal(postingProvider('https://www.glassdoor.com/job-listing/a.htm?jl=100000000001').name,'Glassdoor');
  for (const [input, site] of [['https://evil.example/linkedin.com/jobs/view/123456',null],['https://www.indeed.com/viewjob?jk=abcdefgh12345678','Glassdoor'],['https://user@www.linkedin.com/jobs/view/123456',null]]) assert.throws(() => postingProvider(input,site));
  const html = await fixture('glassdoor-structured.html');
  const result = await fetchProviderJob('https://www.glassdoor.com/job-listing/nurse.htm?jl=100000000003',null,{get:async url => url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : html});
  assert.equal(result.source,'Glassdoor'); assert.equal(result.title,'Registered Nurse');
});
test('saved, export, stats and offline doctor recognize Glassdoor', async () => {
  const dir = await mkdtemp(join(tmpdir(),'jobs-cli-multi-')), db = join(dir,'jobs.json');
  try {
    await saveJobs([{id:'123456',source:'LinkedIn',title:'Chef'},{id:'123456',source:'Glassdoor',title:'Nurse'}],db);
    const env = {JOBS_DB:db};
    const saved = cli(['saved','--website','Glassdoor','--format','json'],env);
    assert.equal(saved.status,0,saved.stderr); assert.equal(JSON.parse(saved.stdout)[0].source,'Glassdoor');
    const stats = cli(['stats','--website','glassdoor'],env);
    assert.deepEqual(JSON.parse(stats.stdout).byWebsite,{Glassdoor:1});
    const output = join(dir,'out.json');
    const exported = cli(['export','--website','Glassdoor','--format','json','-o',output],env);
    assert.equal(exported.status,0,exported.stderr); assert.equal(JSON.parse(await readFile(output,'utf8')).length,1);
    const doctor = cli(['doctor','--website','Glassdoor'],env);
    assert.equal(doctor.status,0,doctor.stderr); assert.deepEqual(JSON.parse(doctor.stdout).websites,['Glassdoor']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
