import test from 'node:test';import assert from 'node:assert/strict';import {parseIndeedCards} from '../src/indeed.js';
const raw={jk:'abcdef12345678',title:'Chef',company:'Kitchen'};
const page=(mosaic,initial)=>`<script>window.mosaic.providerData["mosaic-provider-jobcards"]=${mosaic};window._initialData=${JSON.stringify(initial)};</script>`;
test('Indeed initialData survives empty, placeholder, malformed and irrelevant Mosaic data',()=>{
 for(const value of ['{}','{"placeholder":true}','{"results":[]}','{"results":[{"jk":"bad","title":"Chef"}]}','notJSON()'])assert.equal(parseIndeedCards(page(value,{results:[raw]}))[0]?.id,raw.jk);
});
test('Indeed merges usable independent sources by ID and quarantines conflicting identities',()=>{
 const records=parseIndeedCards(page(JSON.stringify({results:[raw]}),{results:[{...raw,formattedLocation:'Boston'},{...raw,jk:'fedcba87654321'}]}));
 assert.equal(records.length,2);assert.equal(records[0].location,'Boston');
 const conflict=parseIndeedCards(page(JSON.stringify({results:[raw]}),{results:[{...raw,company:'Other Employer'}]}));assert.equal(conflict.length,0);assert.ok(conflict.schemaRejected>0);
});
