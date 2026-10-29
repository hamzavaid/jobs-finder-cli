import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeOptions} from '../src/filters.js';
import {makeIndeedUrl, parseIndeedCards, extractJsonAssignment, indeedJobId, findIndeedJobs as actualFind, parseIndeedDetail} from '../src/indeed.js';

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

test('Indeed changed structured markup cannot masquerade as an empty result', async () => {
  await assert.rejects(findIndeedJobs(normalizeOptions({search:'chef'}),{get:async () => '<script>window.mosaic.providerData["mosaic-provider-jobcards"]={"newSchema":true}</script>'}),/unrecognized search HTML/);
});
test('Indeed detail decodes structured descriptions without changing the source text', () => {
  const job = parseIndeedDetail('<script type="application/ld+json">{"@type":"JobPosting","title":"Chef","hiringOrganization":{"name":"Bakery"},"description":"<p>Bake &amp; decorate</p>"}</script>');
  assert.equal(job.description,'Bake & decorate');
});

test('Indeed rejects conflicting detail identity and unsafe authenticated URL forms',()=> {
 const html='<script type="application/ld+json">{"@type":"JobPosting","title":"Nurse","url":"https://www.indeed.com/viewjob?jk=wrongjob12345678"}</script>';
 assert.throws(()=>parseIndeedDetail(html,{id:'expected12345678'}),/different posting/);
 for(const url of ['https://user@www.indeed.com/viewjob?jk=abcdefgh12345678','https://www.indeed.com:444/viewjob?jk=abcdefgh12345678','https://www.indeed.com/Salary?jk=abcdefgh12345678']) assert.throws(()=>indeedJobId(url));
});
test('Indeed hybrid metadata overrides ambiguous remote boolean and indexed date is not a posting date',()=> {
 const html='<script>window._initialData={"results":[{"jk":"abcdef12345678","title":"Nurse","company":"Hospital","isRemote":true,"workplaceType":"hybrid","dateOnIndeed":1761000000000}]}</script>';
 const [job]=parseIndeedCards(html);assert.equal(job.workplace,'hybrid');assert.equal(job.postedAt,null);assert.ok(job.indexedAt);
});
test('Indeed merges non-null DOM evidence and bounds structured nesting',()=> {
 const html='<script>window._initialData={"results":[{"jk":"abcdef12345678","title":"Nurse","company":"Hospital"}]}</script><div data-jk="abcdef12345678"><h2 class="jobTitle">Nurse</h2><span class="companyName">Hospital</span><span class="companyLocation">Boston</span></div>';
 assert.equal(parseIndeedCards(html)[0].location,'Boston');
 assert.equal(extractJsonAssignment('x='+ '['.repeat(100)+'0'+']'.repeat(100),/x=/),null);
});

function findIndeedJobs(options,http) {return actualFind(options,{get:url=>url.endsWith('/robots.txt')?Promise.resolve('User-agent: *\nAllow: /'):http.get(url)},{cache:false});}
