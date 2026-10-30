import test from 'node:test';import assert from 'node:assert/strict';import {searchCacheKey} from '../src/collection.js';import {normalizeOptions} from '../src/filters.js';
test('source caches depend on effective criteria and budgets rather than unrelated provider selection',()=>{
 const only=normalizeOptions({website:'Greenhouse',search:'Chef'}),both=normalizeOptions({website:['Greenhouse','Lever'],search:'Chef'});
 const key=searchCacheKey(only,'Greenhouse');assert.equal(searchCacheKey(both,'Greenhouse'),key);assert.equal(searchCacheKey({...both,websites:[...both.websites].reverse()},'Greenhouse'),key);
 for(const change of [{company:'Other'},{search:'Nurse'},{limit:26},{pages:2},{strict:true},{details:true},{dateSeconds:86400},{employment:'contract'}])assert.notEqual(searchCacheKey({...only,...change},'Greenhouse'),key);
 assert.notEqual(searchCacheKey(only,'Lever'),key);
 assert.notEqual(searchCacheKey(only,'Greenhouse',{maxBoards:1,maxEnrichments:40,maxBulkEnrichments:8}),key);
});
