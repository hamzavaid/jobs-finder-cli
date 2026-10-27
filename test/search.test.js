import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeOptions} from '../src/filters.js';
import {findJobs} from '../src/search.js';
import {serializeJobs} from '../src/output.js';

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
test('find deduplicates pagination and filters company locally', async () => {
  const page = await fixture('search.html');
  const http = {get: async () => page};
  const options = normalizeOptions({search:'chef', company:'Acme Kitchens', pages:3, limit:25, website:['LinkedIn']});
  const {jobs, stats} = await findJobs(options, http);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, 'Sous Chef');
  assert.equal(stats.pages, 2); // same page repeated: stop
});
test('true under filter excludes jobs observed to have >= 10 applicants', async () => {
  const page = await fixture('search.html');
  const detail = '<span class="num-applicants__caption">Over 200 applicants</span>';
  const http = {get: async url => url.includes('jobPosting/') ? detail : page};
  const options = normalizeOptions({search:'chef', company:'Acme Kitchens', under:'True', pages:2, website:['LinkedIn']});
  const {jobs} = await findJobs(options, http);
  assert.equal(jobs.length, 0);
});
test('CSV escaping and deterministic output', () => {
  const csv = serializeJobs([{id:'123', title:'Chef, "Lead"', company:'Acme'}], 'csv');
  assert.match(csv, /"Chef, ""Lead"""/);
  assert.ok(csv.startsWith('"source","id","title"')); 
  assert.match(serializeJobs([{id:'444', title:'=HYPERLINK(\"bad\")'}], 'csv'), /\"'=HYPERLINK/);
});
