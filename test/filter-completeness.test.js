import test from 'node:test';import assert from 'node:assert/strict';import {FilterEngine} from '../src/filter-engine.js';import {normalizeOptions} from '../src/filters.js';
test('ATS enrichment requirements include missing hard-filter evidence independently of description',()=>{
 const job={source:'Lever',title:'Chef',description:'Prepare meals',descriptionCompleteness:'complete',detailsFetched:true};
 const engine=new FilterEngine(normalizeOptions({search:'Chef',website:'Lever',employment:'full-time'}));
 assert.equal(engine.evaluate(job).needsEnrichment,true);
 assert.equal(engine.evaluate({...job,employmentType:'Full-time'}).needsEnrichment,false);
 assert.equal(engine.evaluate({...job,employmentType:'Contract'}).needsEnrichment,false);
 const unsupported=new FilterEngine(normalizeOptions({search:'Chef',website:'Lever',under:'true'}));assert.equal(unsupported.evaluate(job).needsEnrichment,false);
});
