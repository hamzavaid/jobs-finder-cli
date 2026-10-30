import test from 'node:test';import assert from 'node:assert/strict';
import {mergeJobEvidence} from '../src/field-evidence.js';
test('new observations win over cached conflicts while missing fields retain dated evidence',()=>{
 const previous={source:'LinkedIn',id:'1',workplace:'onsite',description:'Full duties',descriptionCompleteness:'complete',postedAt:'2026-10-01T00:00:00Z',datePrecision:'instant',lastObservedAt:'2026-10-28T00:00:00Z'};
 const result=mergeJobEvidence(previous,{source:'LinkedIn',id:'1',workplace:'remote',description:null,postedAt:null,datePrecision:null,lastObservedAt:'2026-10-29T00:00:00Z'});
 assert.equal(result.workplace,'remote');assert.equal(result.description,'Full duties');assert.equal(result.postedAt,previous.postedAt);assert.equal(result.datePrecision,'instant');
 assert.equal(result.fieldEvidence.description.observedAt,previous.lastObservedAt);assert.equal(result.fieldEvidence.description.retained,true);
 assert.equal(result.fieldEvidence.workplace.observedAt,'2026-10-29T00:00:00Z');
 assert.equal(mergeJobEvidence(result,{workplace:'hybrid',lastObservedAt:'2026-10-27T00:00:00Z'}).workplace,'remote');
});
test('explicit source removals and complete-description precedence are preserved',()=>{
 const previous={description:'Full duties',descriptionCompleteness:'complete',postedAt:'2026-10-01T00:00:00Z',datePrecision:'instant'};
 assert.equal(mergeJobEvidence(previous,{description:'Snippet',descriptionCompleteness:'partial'}).description,'Full duties');
 const removed=mergeJobEvidence(previous,{removedFields:['description','postedAt']});
 assert.equal(removed.description,null);assert.equal(removed.descriptionCompleteness,'title-only');assert.equal(removed.postedAt,null);assert.equal(removed.datePrecision,null);
});
