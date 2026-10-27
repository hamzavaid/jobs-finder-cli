import test from 'node:test';
import assert from 'node:assert/strict';
import {FilterEngine} from '../src/filter-engine.js';
import {normalizeOptions} from '../src/filters.js';
const make = extra => new FilterEngine(normalizeOptions({search:'nurse',website:'Ashby',...extra}),{now:() => Date.parse('2026-10-27T12:00:00Z')});
const job = {source:'Ashby',id:'1',title:'Registered Nurse',company:'Hospital',companyEvidence:'observed',location:'Boston',secondaryLocations:['Cambridge'],workplace:'hybrid',employmentType:'FullTime',postedAt:'2026-10-27T10:00:00Z',datePrecision:'instant',verified:null,underTenApplicants:null};
test('ATS filters work across occupations and secondary locations, without treating hybrid as remote-only', () => {
  assert.equal(make({location:'cambridge',remote:'false',date:'1d',employment:'full-time'}).evaluate(job).match,true);
  assert.equal(make({remote:'true'}).evaluate(job).match,false);
  assert.equal(make({search:'chef'}).evaluate(job).match,false);
  assert.equal(make({location:'Chicago'}).evaluate(job).match,false);
});
test('strict employer filtering rejects inferred board labels and unknown experience stays unknown', () => {
  assert.equal(make({company:'Hospital',strict:true}).evaluate(job).match,true);
  assert.equal(make({company:'Hospital',strict:true}).evaluate({...job,companyEvidence:'board-identifier'}).match,false);
  assert.equal(make({experience:'entry'}).evaluate({...job,title:'Entry Level Nurse'}).match,false);
  assert.equal(make({verified:'false'}).evaluate(job).match,false);
});
test('ATS recent sorting uses public posting time and keeps unknown dates last; relevant favors titles', () => {
  const rows = [{...job,id:'old',postedAt:'2026-10-01T00:00:00Z'},{...job,id:'unknown',postedAt:null},{...job,id:'new'}];
  assert.deepEqual(make({sort:'recent'}).sort(rows).map(row => row.id),['new','old','unknown']);
  const relevant = make({sort:'relevant'}).sort([{...job,id:'description',title:'Coordinator',description:'Support nurse scheduling'},{...job,id:'title',title:'Nurse'}]);
  assert.equal(relevant[0].id,'title');
});
