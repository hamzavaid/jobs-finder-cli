import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBoolean, parseDuration, normalizeOptions, makeSearchUrl, evaluateJob, normalizeCompany} from '../src/filters.js';

test('booleans and dates validate', () => {
  assert.equal(parseBoolean('True'), true);
  assert.equal(parseBoolean('FALSE'), false);
  assert.throws(() => parseBoolean('occasionally'));
  assert.equal(parseDuration('1d'), 86400);
  assert.equal(parseDuration('1w'), 604800);
  assert.throws(() => parseDuration('yesterday'));
});
test('all user-required flags map to a guest query', () => {
  const o = normalizeOptions({search:'software engineer', date:'1d', company:'Google', remote:'True', experience:'entry', employment:'internship', under:'True', verified:'True', location:'Los Angeles'});
  const u = new URL(makeSearchUrl(o));
  assert.equal(u.searchParams.get('keywords'), 'software engineer Google entry-level');
  assert.equal(u.searchParams.get('f_TPR'), 'r86400');
  assert.equal(u.searchParams.get('f_E'), '2');
  assert.equal(u.searchParams.get('f_JT'), 'I');
  assert.equal(u.searchParams.get('f_WT'), '2');
  assert.equal(u.searchParams.get('f_EA'), 'true');
  assert.equal(u.searchParams.get('f_VJ'), 'true');
  assert.equal(u.searchParams.get('location'), 'Los Angeles');
});
test('remote false requests non-remote workplace types', () => {
  const o = normalizeOptions({search:'chef', remote:'false'});
  assert.equal(new URL(makeSearchUrl(o)).searchParams.get('f_WT'), '1,3');
});
test('no default occupation and company-name normalization', () => {
  assert.equal(normalizeCompany('ACME Kitchens, Inc.'), normalizeCompany('acme kitchens'));
  assert.throws(() => normalizeOptions({}));
  assert.equal(normalizeOptions({search:'accountant'}).search, 'accountant');
});
test('unknown counts are excluded for both booleans despite LinkedIn facets', () => {
  const job = {company: 'Acme', underTenApplicants:null, verified:null};
  const o1 = normalizeOptions({search:'cook', under:'false'});
  assert.equal(evaluateJob(job, o1).match, false);
  const o2 = normalizeOptions({search:'cook', under:'true'});
  assert.equal(evaluateJob(job, o2).match, false);
  assert.deepEqual(evaluateJob(job, o2).facetReliant, ['under']);
  assert.equal(evaluateJob(job, {...o2, strict:true}).match, false);
});
test('positive observed count cannot override contradiction', () => {
  const o = normalizeOptions({search:'chef', under:'true'});
  assert.equal(evaluateJob({underTenApplicants:false}, o).match, false);
});
