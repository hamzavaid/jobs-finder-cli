import test from 'node:test';import assert from 'node:assert/strict';import {createHttpClient} from '../src/http.js';
test('a slow HTML host does not serialize an independent host',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;}),started=[];
 const http=createHttpClient({delayMs:0,retries:0,fetchImpl:async url=>{started.push(new URL(url).hostname);if(url.includes('linkedin'))await held;return new Response('ok');}});
 const first=http.get('https://www.linkedin.com/jobs/search'),second=http.get('https://www.indeed.com/jobs');
 await new Promise(resolve=>setImmediate(resolve));
 const before=[...started];release();await Promise.all([first,second]);assert.deepEqual(before,['www.linkedin.com','www.indeed.com']);
});
test('same-host HTML requests retain spacing and recover after failures',async()=>{
 let time=0;const starts=[];
 const http=createHttpClient({delayMs:100,retries:0,now:()=>time,sleep:async ms=>{time+=ms;},fetchImpl:async()=>{starts.push(time);if(starts.length===1)throw new Error('network');return new Response('ok');}});
 const result=await Promise.allSettled(Array.from({length:3},()=>http.get('https://www.linkedin.com/jobs/search')));
 assert.deepEqual(starts,[0,100,200]);assert.deepEqual(result.map(item=>item.status),['rejected','fulfilled','fulfilled']);
});
