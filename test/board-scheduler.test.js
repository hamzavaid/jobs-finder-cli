import test from 'node:test';import assert from 'node:assert/strict';import {scheduleBoards,observeBoard} from '../src/board-scheduler.js';
test('board scheduling reserves exploration and decays historical relevance deterministically',()=>{
 const now=Date.parse('2026-10-28T00:00:00Z'),options={search:'chef',company:'',location:''};
 const boards=Array.from({length:8},(_,id)=>({board:{id:String(id),lastJobFetchAt:'2026-10-27T00:00:00Z'}}));boards[0].board.lastJobFetchAt=null;boards[7].board=observeBoard(boards[7].board,options,30,now);
 const result=scheduleBoards(boards,options,{now,budget:4});assert.equal(result[0].board.id,'0');assert.equal(result[1].board.id,'7');assert.deepEqual(scheduleBoards(boards,options,{now,budget:4}),result);
 const company=scheduleBoards(boards,{...options,company:'Employer'},{now,budget:4});assert.equal(company.length,8);
});
