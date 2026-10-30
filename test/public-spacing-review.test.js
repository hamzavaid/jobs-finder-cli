import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';import {createPublicHttp} from '../src/public-http.js';
function transport(starts,now) {return (url,options,respond)=>{starts.push({host:url.hostname,time:now()});const request=new EventEmitter();request.end=()=>queueMicrotask(()=>{const response=Readable.from([Buffer.from('ok')]);response.statusCode=200;respond(response);response.on('end',()=>request.emit('close'));});return request;};}
test('public requests reserve distinct same-host starts without blocking independent hosts',async()=>{
 let time=0;const starts=[],http=createPublicHttp({now:()=>time,sleep:async ms=>{time+=ms;},requestImpl:transport(starts,()=>time)});
 await Promise.all(Array.from({length:4},()=>http.get('https://employer.example/jobs/1')));
 assert.deepEqual(starts.map(item=>item.time),[0,1200,2400,3600]);
 let release;const paused=new Promise(resolve=>{release=resolve;});const otherStarts=[];
 const other=createPublicHttp({now:()=>0,sleep:()=>paused,requestImpl:transport(otherStarts,()=>0)});
 await other.get('https://first.example/job');const waiting=other.get('https://first.example/job');
 await other.get('https://second.example/job');assert.equal(otherStarts.length,2);release();await waiting;
});
test('public spacing cancellation never dispatches a waiting request',async()=>{
 const controller=new AbortController();let began;const waiting=new Promise(resolve=>{began=resolve;});const starts=[];
 const http=createPublicHttp({signal:controller.signal,now:()=>0,sleep:async()=>{began();controller.abort();},requestImpl:transport(starts,()=>0)});
 await http.get('https://employer.example/job');const second=http.get('https://employer.example/job');await waiting;
 await assert.rejects(second,{name:'AbortError'});assert.equal(starts.length,1);
});
