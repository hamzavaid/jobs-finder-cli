import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeOptions} from '../src/filters.js';
import {makeIndeedUrl, parseIndeedCards, extractJsonAssignment, indeedJobId, findIndeedJobs} from '../src/indeed.js';

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
test('Indeed URLs translate portable options only', () => {
  const o = normalizeOptions({search:'pastry chef', company:'Example', location:'Los Angeles',
    date:'1d', remote:'True', employment:'internship', experience:'entry', under:'true', verified:'true'});
  const u = new URL(makeIndeedUrl(o, 10));
  assert.equal(u.searchParams.get('q'), 'pastry chef');
  assert.equal(u.searchParams.get('rbc'), 'Example');
  assert.equal(u.searchParams.get('fromage'), '1');
  assert.equal(u.searchParams.get('jt'), 'internship');
  assert.equal(u.searchParams.get('explvl'), 'entry_level');
  assert.equal(u.searchParams.get('sc'), '0kf:attr(DSQF7);');
  assert.equal(u.searchParams.get('start'), '10');
  assert.equal(u.searchParams.has('under'), false);
  assert.equal(u.searchParams.has('verified'), false);
});
test('Mosaic parser handles nested JSON strings and job type', async () => {
  const cards = parseIndeedCards(await fixture('indeed-mosaic.html'));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].title, 'Pastry Chef');
  assert.equal(cards[0].employmentType, 'Full-time');
  assert.equal(cards[0].source, 'Indeed');
  assert.equal(cards[1].workplace, 'remote');
  assert.equal(cards[1].datePrecision, 'instant');
});
test('DOM fallback detects data-jk and title/company', async () => {
  const cards = parseIndeedCards(await fixture('indeed-dom.html'));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].company, 'Seaside Restaurants');
  assert.equal(cards[0].id, 'deadcafe12340000');
});
test('Safe assignment extraction never evaluates JS', () => {
  assert.deepEqual(extractJsonAssignment('window._initialData = {"x":"}\\\"{","y":{"z":1}}; other()', /window\._initialData\s*=\s*/), {x:'}"{',y:{z:1}});
  assert.equal(extractJsonAssignment('window._initialData = someFunction()', /window\._initialData\s*=\s*/), null);
});
test('Indeed IDs validated', () => {
  assert.equal(indeedJobId('ab12cd34ef56gh78'),'ab12cd34ef56gh78');
  assert.equal(indeedJobId('https://www.indeed.com/viewjob?jk=ab12cd34ef56gh78'), 'ab12cd34ef56gh78');
  assert.throws(() => indeedJobId('https://evil.example/viewjob?jk=ab12cd34ef56gh78'));
});
test('Indeed excludes unknown under-10 and verification, rather than assuming LinkedIn facets', async () => {
  const html = await fixture('indeed-mosaic.html');
  const http = {get:async()=>html};
  const o = normalizeOptions({search:'chef', under:'true', verified:'true', website:['Indeed']});
  const result = await findIndeedJobs(o, http);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.stats.unknownExcluded, 2);
});
