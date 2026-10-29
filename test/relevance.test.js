import test from 'node:test';
import assert from 'node:assert/strict';
import {relevance,rankJobs,tokenize} from '../src/relevance.js';
import {FilterEngine} from '../src/filter-engine.js';
test('occupation-neutral lexical retrieval preserves token boundaries and technical tokens',()=>{
 for(const [query,title] of [['Software Engineer','Software Engineering Intern'],['developer','Development Lead'],['RN','Registered Nurse'],['chef','Chef']]) assert.equal(relevance({title},query).match,true);
 for(const [query,title] of [['Java','JavaScript Engineer'],['C','C++ Developer'],['C#','C++ Developer'],['chef','Chief Accountant']]) assert.equal(relevance({title},query).match,false);
 assert.deepEqual(tokenize('C++ C# .NET Node.js'),['c++','c#','.net','node.js']);
 assert.equal(relevance({title:'Engineer Software'},'"Software Engineer"').match,false);
 assert.equal(relevance({title:'Generalist'},'accountant').needsEnrichment,true);
});
test('ranking is deterministic and separates hard filters from scores',()=>{
 const jobs=[{source:'A',id:'2',title:'Assistant',description:'Software Engineer'},{source:'B',id:'1',title:'Software Engineer'}];
 assert.equal(rankJobs(jobs,{search:'Software Engineer',sort:'relevant'})[0].id,'1');
 assert.deepEqual(rankJobs(jobs,{search:'Software Engineer',sort:'relevant'}),rankJobs([...jobs].reverse(),{search:'Software Engineer',sort:'relevant'}));
 const decision=new FilterEngine({search:'Software Engineer',company:'Other'}).evaluate({...jobs[1],company:'Acme'});
 assert.equal(decision.match,false);assert.equal(decision.hardFilterStatus,false);assert.ok(decision.relevanceScore>0);
});
