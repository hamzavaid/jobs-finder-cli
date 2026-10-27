import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeOptions} from '../src/filters.js';
import {findJobs} from '../src/search.js';
import {saveJobs, savedJobs, statsForSaved} from '../src/store.js';

test('website defaults to both; accepts multiple values and mixed case', () => {
  assert.deepEqual(normalizeOptions({search:'cook'}).websites, ['LinkedIn','Indeed']);
  assert.deepEqual(normalizeOptions({search:'cook',website:['indeed','LINKEDIN','Indeed']}).websites, ['Indeed','LinkedIn']);
  assert.deepEqual(normalizeOptions({search:'cook',website:['linkedin,indeed']}).websites, ['LinkedIn','Indeed']);
  assert.throws(() => normalizeOptions({search:'cook',website:['glassdoor']}), /Unknown --website/);
});
test('two-source search merges both providers without mixing IDs', async () => {
  const linkedin = await readFile(new URL('./fixtures/search.html', import.meta.url), 'utf8');
  const indeed = await readFile(new URL('./fixtures/indeed-mosaic.html', import.meta.url), 'utf8');
  const http = {get:async url => url.includes('indeed.com') ? indeed : linkedin};
  const options = normalizeOptions({search:'chef', pages:1, website:['LinkedIn','Indeed']});
  const result = await findJobs(options, http);
  assert.ok(result.jobs.some(j=>j.source==='LinkedIn'));
  assert.ok(result.jobs.some(j=>j.source==='Indeed'));
  assert.equal(result.stats.errors.length, 0);
});
test('failure of one provider does not discard other provider', async () => {
  const indeed = await readFile(new URL('./fixtures/indeed-mosaic.html', import.meta.url), 'utf8');
  const http = {get:async url => url.includes('linkedin.com') ? Promise.reject(new Error('HTTP 403')) : indeed};
  const result = await findJobs(normalizeOptions({search:'accountant', website:['LinkedIn','Indeed']}), http);
  assert.equal(result.stats.errors.length, 1);
  assert.ok(result.jobs.every(j=>j.source==='Indeed'));
});
test('saved IDs are namespaced by site', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'jobs-test-')), 'db.json');
  try {
    await saveJobs([{id:'abcde1234',source:'LinkedIn',title:'Cook'}, {id:'abcde1234',source:'Indeed',title:'Cook'}], path);
    assert.equal((await savedJobs(path)).length, 2);
    assert.deepEqual((await statsForSaved(path)).byWebsite, {LinkedIn:1, Indeed:1});
  } finally {await rm(join(path,'..'),{recursive:true, force:true});}
});
