import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSearchCards, parseJobDetail, canonicalJobId} from '../src/parser.js';

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
test('parse cards for arbitrary occupations', async () => {
  const result = parseSearchCards(await fixture('search.html'));
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'Sous Chef');
  assert.equal(result[1].title, 'Tax Accountant');
  assert.equal(result[0].id, '1234567890');
  assert.equal(result[0].datePrecision, 'day');
});
test('parse detail with accurate applicant count and job criteria', async () => {
  const details = parseJobDetail(await fixture('detail.html'), {id: '1234567890'});
  assert.equal(details.applicantCount, 8);
  assert.equal(details.underTenApplicants, true);
  assert.equal(details.verified, true);
  assert.equal(details.workplace, 'onsite');
  assert.equal(details.employmentType, 'Full-time');
  assert.match(details.description, /Cook fresh dishes/);
});
test('do not turn under-first-25 into less than ten', () => {
  const html = '<span class="num-applicants__caption">Be among the first 25 applicants</span>';
  const obj = parseJobDetail(html, {id:'9999999'});
  assert.equal(obj.applicantCount ?? null, null);
  assert.equal(obj.underTenApplicants ?? null, null);
});
test('canonicalJobId works with an ID, url and URN', () => {
  assert.equal(canonicalJobId('1234567890'), '1234567890');
  assert.equal(canonicalJobId('https://www.linkedin.com/jobs/view/chef-at-acme-1234567890?foo=bar'), '1234567890');
  assert.equal(canonicalJobId('urn:li:jobPosting:1234567890'), '1234567890');
});

test('employer verification does not imply a verified job and URL query text is not a posting path', () => {
  const detail = '<h1 class="topcard__title">Chef</h1><div aria-label="Verified employer"></div>';
  assert.equal(parseJobDetail(detail).verified,null);
  assert.equal(parseJobDetail(detail + '<div aria-label="Job is not verified"></div>').verified,false);
  assert.throws(() => canonicalJobId('https://www.linkedin.com/login?redirect=/jobs/view/123456789'));
  assert.throws(() => canonicalJobId('https://user:pass@www.linkedin.com/jobs/view/123456789'));
});
