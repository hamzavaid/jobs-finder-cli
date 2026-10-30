import test from 'node:test';import assert from 'node:assert/strict';import {relevance} from '../src/relevance.js';import {evaluateJob,normalizeOptions} from '../src/filters.js';
test('entry-level keyword queries recognize clear early-career wording without losing occupation terms',()=>{
 const query='Software Engineer entry-level';
 for(const title of ['Entry Level Software Engineer','Junior Software Engineer','Graduate Software Engineer','Software Engineer (New Grad)','Early Career Software Engineer'])assert.equal(relevance({title,description:'Build applications',descriptionCompleteness:'complete'},query).match,true,title);
 for(const title of ['Senior Software Engineer','Junior Chef','Graduate School Administrator'])assert.equal(relevance({title,description:'Role duties',descriptionCompleteness:'complete'},query).match,false,title);
 assert.equal(relevance({title:'Junior Accountant'},'Accountant entry-level').match,true);
 assert.equal(relevance({title:'Junior Software Engineer'},'Software Engineer "entry-level"').match,false);
 assert.equal(relevance({title:'Senior Software Engineer',description:'Mentor junior engineers',descriptionCompleteness:'complete'},query).match,false);
 // Keywords can match observed duties; they do not silently become a hard experience filter.
 const senior={title:'Senior Software Engineer',description:'Lead our entry-level software engineer training'};
 assert.equal(relevance(senior,query).match,true);
 assert.equal(evaluateJob(senior,normalizeOptions({search:'Software Engineer',experience:'entry'})).match,false);
});
