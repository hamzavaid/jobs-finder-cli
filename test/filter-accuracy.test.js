import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOptions, evaluateJob, parseDuration, normalizeWebsites, knownEmployment, knownExperience} from '../src/filters.js';
import {indeedFacets} from '../src/indeed.js';
const o = extra => normalizeOptions({search:'electrician',...extra});
test('all boolean spellings, date boundaries and conflicting choices validate', () => {
  for (const value of ['true','TRUE','yes','1']) assert.equal(o({remote:value}).remote,true);
  for (const value of ['false','FALSE','no','0']) assert.equal(o({remote:value}).remote,false);
  for (const value of ['sometimes','',null]) assert.throws(() => o({remote:value}));
  for (const input of [{remote:'true',workplace:'hybrid'},{limit:201},{pages:0},{delay:749},{sort:'salary'},{format:'xml'},{employment:'invalid'},{experience:'invalid'}]) assert.throws(() => o(input));
  assert.equal(parseDuration('365d'),31536000);
  for (const value of ['0h','366d','3m','1.5d']) assert.throws(() => parseDuration(value));
  assert.throws(() => normalizeWebsites(['Glassdoor','']));
});
test('observed workplace, company, employment and seniority override contradictory facets', () => {
  const job = {source:'Glassdoor',company:'Power LLC',workplace:'hybrid',employmentType:'FULL_TIME',seniorityLevel:'Entry level'};
  assert.equal(evaluateJob(job,o({company:'Power',remote:'false',employment:'full-time',experience:'entry'})).match,true);
  for (const extra of [{remote:'true'},{employment:'contract'},{experience:'executive'},{company:'Other'}]) assert.equal(evaluateJob(job,o(extra)).match,false);
  assert.equal(evaluateJob({...job,location:'Boston, MA'},o({location:'boston'})).match,true);
  assert.equal(evaluateJob(job,o({location:'boston'})).match,false);
});
test('date exact boundaries, invalid/future values and coarse Indeed buckets stay conservative', () => {
  const now = Date.parse('2026-10-27T12:00:00Z'), options = o({date:'1d'});
  assert.equal(evaluateJob({postedAt:'2026-10-26T12:00:00Z',datePrecision:'instant'},options,now).match,true);
  assert.equal(evaluateJob({postedAt:'2026-10-26T11:59:59Z',datePrecision:'instant'},options,now).match,false);
  assert.equal(indeedFacets(o({date:'1h'})).includes('date'),false);
  assert.equal(indeedFacets(o({date:'1d'})).includes('date'),false); // A URL parameter alone is not evidence.
  assert.equal(indeedFacets(o({date:'2d'})).includes('date'),false);
  assert.equal(evaluateJob({source:'Glassdoor',postedAt:'2026-10-27',datePrecision:'day'},options,now).match,false);
});
test('strict removes only unverified facets; unknown false never means observed false', () => {
  for (const source of ['LinkedIn','Indeed','Glassdoor']) {
    assert.equal(evaluateJob({source,verified:null},o({verified:'false'})).match,false);
    assert.equal(evaluateJob({source,verified:false},o({verified:'false',strict:true})).match,true);
  }
  const loose = o({under:'true'}), strict = {...loose,strict:true};
  assert.equal(evaluateJob({source:'LinkedIn'},loose).match,true);
  assert.equal(evaluateJob({source:'LinkedIn'},strict).match,false);
});

test('calendar dates reject definite contradictions and verify only fully enclosed intervals', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(evaluateJob({postedAt:'2020-01-01',datePrecision:'day'},o({date:'1d'}),now).match,false);
  assert.equal(evaluateJob({postedAt:'2099-01-01',datePrecision:'day'},o({date:'1d'}),now).match,false);
  assert.equal(evaluateJob({source:'Glassdoor',postedAt:'2026-10-24',datePrecision:'day'},o({date:'7d',strict:true}),now).match,true);
  assert.equal(evaluateJob({source:'Glassdoor',postedAt:'bad',datePrecision:'day'},o({date:'7d'}),now).match,false);
});
test('taxonomy matching preserves multiple types and avoids substring inventions', () => {
  assert.equal(knownEmployment('International'),null); assert.equal(knownEmployment('Other'),'O');
  assert.equal(knownExperience('Associate Director'),'5'); assert.equal(knownExperience('Senior Director'),'5');
  assert.equal(evaluateJob({source:'Glassdoor',employmentType:'FULL_TIME, CONTRACT'},o({employment:'contract'})).match,true);
  assert.equal(evaluateJob({source:'Glassdoor',employmentType:'International'},o({employment:'internship'})).match,false);
});
