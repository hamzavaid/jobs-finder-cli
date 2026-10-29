import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHttpClient} from '../src/http.js';
import {normalizeOptions, evaluateJob} from '../src/filters.js';
import {parseJobDetail, canonicalJobId} from '../src/parser.js';
import {saveJobs, savedJobs} from '../src/store.js';
import {findJobs as actualFind} from '../src/search.js';
import {parseIndeedDetail} from '../src/indeed.js';

const cli = (...args) => spawnSync(process.execPath, ['bin/jobs.js', ...args], {encoding:'utf8'});
test('CLI constructs every command and rejects invalid local arguments', () => {
  for (const name of ['', 'find','job','saved','export','stats','url','doctor']) {
    const result = cli(...(name ? [name] : []), '--help');
    assert.equal(result.status, 0, result.stderr);
  }
  for (const args of [['saved','--limit','-1'], ['saved','--format','yaml'], ['job','123456','--delay','NaN'], ['job','123456','--format','yaml']]) {
    assert.equal(cli(...args).status, 1);
  }
});
test('invalid prototype keys and timestamps cannot bypass validation', () => {
  for (const key of ['__proto__','constructor','toString']) {
    assert.throws(() => normalizeOptions({search:'chef', experience:key}));
    assert.throws(() => normalizeOptions({search:'chef', website:key}));
  }
  const options = normalizeOptions({search:'chef', date:'1d'});
  assert.equal(evaluateJob({postedAt:'bad',datePrecision:'instant'}, options).match, false);
  assert.equal(evaluateJob({postedAt:'2099-01-01T00:00:00Z',datePrecision:'instant'}, options).match, false);
  assert.throws(() => canonicalJobId('https://evil.example/jobs/view/123456789'));
});
test('applicant lower bounds do not fabricate exact counts or ten-applicant threshold', () => {
  for (const [count, expected] of [[5,null],[9,false],[200,false]]) {
    const job = parseJobDetail(`<span class="num-applicants__caption">Over ${count} applicants</span>`);
    assert.equal(job.applicantCount, null);
    assert.equal(job.underTenApplicants, expected);
  }
});
test('HTTP serializes callers and spaces request starts', async () => {
  let clock = 0, active = 0, maximum = 0;
  const starts = [];
  const http = createHttpClient({delayMs:750, now:() => clock, sleep:async ms => {clock += ms;}, fetchImpl:async () => {
    starts.push(clock); active++; maximum = Math.max(maximum,active);
    await Promise.resolve(); active--;
    return {ok:true,status:200,text:async () => '<p>ok</p>'};
  }});
  await Promise.all([http.get('https://example.com/1'),http.get('https://example.com/2'),http.get('https://example.com/3')]);
  assert.equal(maximum,1); assert.deepEqual(starts,[0,750,1500]);
});
test('HTTP retries transient network and server failures, disposes failed responses', async () => {
  let calls = 0, canceled = 0;
  const http = createHttpClient({delayMs:0, sleep:async () => {}, fetchImpl:async () => {
    calls++;
    if (calls === 1) throw new TypeError('connection reset');
    if (calls === 2) return {ok:false,status:503,body:{cancel:async () => {canceled++;}}};
    return {ok:true,status:200,text:async () => 'ok'};
  }});
  assert.equal(await http.get('https://example.com'), 'ok'); assert.equal(calls,3); assert.equal(canceled,1);
});
test('HTTP bounds body-read timeout and never retries blocks even with card markers', async () => {
  const http = createHttpClient({delayMs:0,timeoutMs:10,retries:0,fetchImpl:async () => ({ok:true,status:200,text:() => new Promise(() => {})})});
  await assert.rejects(http.get('https://example.com'), /timed out/);
  for (const status of [401,403,429,999]) {
    let calls = 0;
    const blocked = createHttpClient({delayMs:0,fetchImpl:async () => {calls++; return {ok:false,status};}});
    await assert.rejects(blocked.get('https://example.com'), /restricted/); assert.equal(calls,1);
  }
  const challenge = createHttpClient({delayMs:0,fetchImpl:async () => ({ok:true,status:200,text:async () => '<title>Just a moment</title><div class="base-search-card"></div>'})});
  await assert.rejects(challenge.get('https://example.com'), /Access challenge/);
});
test('store serializes simultaneous saves, migrates legacy rows and preserves corrupt input', async () => {
  const dir = await mkdtemp(join(tmpdir(),'jobs-regression-')), path = join(dir,'db.json');
  try {
    await writeFile(path, JSON.stringify({version:1,jobs:{'12345':{id:'12345',title:'Cook'}}}));
    await Promise.all([saveJobs([{id:'12345',title:'Chef'}],path), saveJobs([{id:'56789',source:'Indeed'}],path)]);
    assert.equal((await savedJobs(path)).length,2);
    const db = JSON.parse(await readFile(path,'utf8'));
    assert.equal(db.jobs['12345'],undefined); assert.equal(db.jobs['LinkedIn:12345'].title,'Chef');
    assert.deepEqual(await readdir(dir), ['db.json']);
    await writeFile(path,'{"version":1,"jobs":{"x":null}}');
    await assert.rejects(saveJobs([{id:'99999'}],path), /corrupt/);
    assert.equal(await readFile(path,'utf8'),'{"version":1,"jobs":{"x":null}}');
    assert.deepEqual(await readdir(dir), ['db.json']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('later-page failure preserves accepted jobs and unknown markup is an error', async () => {
  const html = await readFile(new URL('./fixtures/search.html',import.meta.url),'utf8');
  let calls = 0;
  const result = await findJobs(normalizeOptions({search:'chef',website:'LinkedIn'}), {get:async () => {if (calls++) throw new Error('HTTP 403'); return html;}});
  assert.equal(result.jobs.length,1); assert.match(result.stats.errors[0], /partial results/);
  await assert.rejects(findJobs(normalizeOptions({search:'chef',website:'LinkedIn'}), {get:async () => '<html>new layout</html>'}), /All selected sites failed/);
});
test('Indeed structured detail reads graph metadata and keeps unknown attributes null', () => {
  const html = '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Nurse","hiringOrganization":{"name":"Hospital"},"employmentType":"FULL_TIME","jobLocation":{"address":{"addressLocality":"Boston"}},"baseSalary":{"currency":"USD","value":50000}}]}</script>';
  const job = parseIndeedDetail(html,{id:'abcdef1234'});
  assert.equal(job.title,'Nurse'); assert.equal(job.company,'Hospital'); assert.equal(job.location,'Boston');
  assert.equal(job.employmentType,'FULL_TIME'); assert.equal(job.salary.value,50000); assert.equal(job.verified,null);
});

function findJobs(options,http) {return actualFind(options,http,{cache:false});}
