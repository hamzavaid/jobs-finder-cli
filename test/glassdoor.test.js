import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {findGlassdoorJobs as actualFind, parseGlassdoorCards, parseGlassdoorDetail, makeGlassdoorUrl, glassdoorJobId} from '../src/glassdoor.js';
import {normalizeOptions, evaluateJob} from '../src/filters.js';
const fixture = name => readFile(new URL(`./fixtures/${name}`,import.meta.url),'utf8');
const allow = 'User-agent: *\nDisallow: /api/\n';
const options = input => normalizeOptions({search:'chef',...input});
test('Glassdoor DOM cards preserve salary labels, IDs and unknown evidence', async () => {
  const jobs = parseGlassdoorCards(await fixture('glassdoor-dom.html'));
  assert.equal(jobs.length,2); assert.equal(jobs[0].title,'Pastry Chef');
  assert.equal(jobs[0].employmentType,'Full-time'); assert.equal(jobs[0].workplace,'onsite');
  assert.equal(jobs[1].workplace,'remote'); assert.match(jobs[1].salary,/Glassdoor est/);
  assert.equal(jobs[1].verified,null); assert.equal(jobs[1].applicantCount,null);
});
test('Glassdoor parses structured graph, description, date, salary and deduplicates', async () => {
  const html = await fixture('glassdoor-structured.html');
  const jobs = parseGlassdoorCards(html + html);
  assert.equal(jobs.length,1); assert.equal(jobs[0].company,'Example Hospital');
  assert.equal(jobs[0].datePrecision,'instant'); assert.equal(jobs[0].location,'Boston, MA, US');
  assert.equal(jobs[0].salary.value.minValue,70000); assert.match(jobs[0].description,/patients & coordinate/);
  assert.equal(parseGlassdoorDetail(html,{id:'100000000003'}).detailsFetched,true);
});
test('Glassdoor URL validation and occupation-neutral queries', () => {
  assert.match(makeGlassdoorUrl(options({search:'mechanical engineer'})),/mechanical-engineer/);
  assert.equal(glassdoorJobId('https://www.glassdoor.com/job-listing/chef.htm?jl=100000000001'),'100000000001');
  for (const url of ['https://evil.example/job-listing/a?jl=100000000001','http://www.glassdoor.com/job-listing/a?jl=100000000001','https://www.glassdoor.com/Salary/a?jl=100000000001']) assert.throws(() => glassdoorJobId(url));
});
test('Glassdoor unknown filter evidence never inherits LinkedIn facets', () => {
  for (const extra of [{under:'true'},{under:'false'},{verified:'true'},{verified:'false'},{remote:'true'},{employment:'full-time'},{experience:'entry'},{date:'1d'}]) {
    const decision = evaluateJob({source:'Glassdoor'},options(extra));
    assert.equal(decision.match,false,JSON.stringify(extra)); assert.equal(decision.facetReliant.length,0);
  }
});
test('Glassdoor follows allowed public next links, deduplicates repeats, stops robots-disallowed pagination', async () => {
  const html = await fixture('glassdoor-dom.html'), calls = [];
  const http = {get:async url => {calls.push(url); if (url.endsWith('/robots.txt')) return allow; return calls.length === 2 ? html + '<a rel="next" href="/Job/chef-jobs.htm?page=2">Next</a>' : html;}};
  const result = await findGlassdoorJobs(options({pages:3}),http);
  assert.equal(result.jobs.length,2); assert.equal(result.stats.pages,2); assert.match(calls[2],/page=2/);
  const blockedCalls = [];
  const blocked = await findGlassdoorJobs(options({pages:3}),{get:async url => {blockedCalls.push(url); return url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /Job/*_IP*' : html + '<a rel="next" href="/Job/chef-jobs_IP2.htm">Next</a>';}});
  assert.equal(blockedCalls.length,2); assert.match(blocked.stats.errors[0],/robots.txt disallows/);
});
test('Glassdoor rejects login, challenges and unknown HTML; explicit no results is valid', async () => {
  for (const html of ['<title>Sign in</title>', '<title>Just a moment</title>', '<html><body>new layout</body></html>']) {
    await assert.rejects(findGlassdoorJobs(options({pages:1}),{get:async url => url.endsWith('/robots.txt') ? allow : html}));
  }
  const empty = await findGlassdoorJobs(options({pages:1}),{get:async url => url.endsWith('/robots.txt') ? allow : '<div data-test="no-results">No jobs found</div>'});
  assert.equal(empty.jobs.length,0);
});

test('Glassdoor detail never merges a different posting and unavailable crawl policy fails explicitly', async () => {
  assert.throws(() => parseGlassdoorDetail('<script type="application/ld+json">{"@type":"JobPosting","title":"Nurse","url":"https://www.glassdoor.com/job-listing/nurse.htm?jl=100000000003"}</script>',{id:'100000000004'}),/different posting/);
  await assert.rejects(findGlassdoorJobs(options({pages:1}),{get:async () => '<html>robots page unavailable</html>'}),/robots.txt could not be verified/);
});

test('Glassdoor detail URL identity must agree and salary attribution is retained',async()=> {
 const {glassdoorDetailUrl}=await import('../src/glassdoor.js');
 assert.throws(()=>glassdoorDetailUrl('100000000001',{url:'https://www.glassdoor.com/job-listing/a.htm?jl=100000000002'}),/different posting/);
 const jobs=parseGlassdoorCards(await fixture('glassdoor-dom.html'));assert.equal(jobs[1].salarySource,'glassdoor-estimate');
});

function findGlassdoorJobs(options,http) {return actualFind(options,http,{cache:false,accessPolicy:{Glassdoor:{mode:'public-html',evidence:'synthetic offline fixtures'}}});}
