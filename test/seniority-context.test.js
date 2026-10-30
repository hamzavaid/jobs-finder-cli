import test from 'node:test';import assert from 'node:assert/strict';import {evaluateJob,normalizeOptions,titleExperience} from '../src/filters.js';
test('population and reporting relationships do not establish the job holder seniority',()=>{
 for(const [title,experience] of [['Senior Living Caregiver','senior'],['Senior Care Assistant','senior'],['Assistant to Director','director'],['Assistant to the Executive Director','director']]) {
   assert.equal(titleExperience(title).code,null,title);
   const result=evaluateJob({title},normalizeOptions({search:title,experience}));assert.equal(result.match,false);assert.ok([...result.unknowns,...result.facetReliant].includes('experience'));
 }
 assert.equal(evaluateJob({title:'Senior Living Caregiver',seniorityLevel:'Entry level'},normalizeOptions({search:'Caregiver',experience:'entry'})).match,true);
});
test('unambiguous ranks retain conservative entry exclusions and metadata conflicts',()=>{
 for(const [title,code] of [['Assistant Director','5'],['Associate Director','5'],['Director of Nursing','5'],['Junior Engineer','2'],['Senior Engineer','4']])assert.equal(titleExperience(title).code,code);
 for(const title of ['Senior Engineer','Staff Engineer','Principal Engineer'])assert.equal(evaluateJob({title,seniorityLevel:'Entry level'},normalizeOptions({search:'Engineer',experience:'entry'})).match,false);
 assert.equal(evaluateJob({title:'Junior Engineer',seniorityLevel:'Senior'},normalizeOptions({search:'Engineer',experience:'entry'})).match,false);
});
