import test from 'node:test';import assert from 'node:assert/strict';import {measureBoards} from '../scripts/board-performance.js';
test('cached-board observation preserves all identities with bounded bookkeeping work',async()=>{
 for(const count of [100,500]) {
  const result=await measureBoards(count);assert.equal(result.visited,count);assert.equal(result.observed,count);assert.equal(result.requests,0);
  assert.ok(result.identityReads<count*100,`${result.identityReads} identity reads for ${count} boards`);
  assert.ok(result.arrayComparisons<count*100,`${result.arrayComparisons} linear-search comparisons for ${count} boards`);
 }
});
