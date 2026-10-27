import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOptions, evaluateJob} from '../src/filters.js';

test('default searches all three websites', () => {
  assert.deepEqual(normalizeOptions({search:'sous chef'}).websites, ['LinkedIn','Indeed','Glassdoor']);
});
test('supports the exact multi-value website syntax with case-insensitive names', () => {
  assert.deepEqual(normalizeOptions({search:'accountant',website:['LinkedIn','Indeed']}).websites, ['LinkedIn','Indeed']);
  assert.deepEqual(normalizeOptions({search:'accountant',website:['indeed','LINKEDIN','indeed']}).websites, ['Indeed','LinkedIn']);
  assert.deepEqual(normalizeOptions({search:'accountant',website:['Indeed,LinkedIn']}).websites, ['Indeed','LinkedIn']);
  assert.throws(() => normalizeOptions({search:'chef',website:['Other']}), /Unknown --website/);
});
test('Indeed cannot assert unobserved applicant and verification facets', () => {
  const o = normalizeOptions({search:'accountant', under:'true', verified:'true', website:['Indeed']});
  const e = evaluateJob({source:'Indeed', underTenApplicants:null, verified:null}, {...o, provider:'Indeed', indeedSupportedFacets:[]});
  assert.equal(e.match, false);
  assert.deepEqual(e.unknowns, ['under','verified']);
});
test('Indeed unsupported date range is not treated as verified', () => {
  const o = normalizeOptions({search:'chef', date:'30d'});
  const e = evaluateJob({postedAt:null, datePrecision:null}, {...o, provider:'Indeed', indeedSupportedFacets:[]});
  assert.equal(e.match, false);
  assert.deepEqual(e.unknowns, ['date']);
});
