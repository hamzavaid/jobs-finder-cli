import {performance} from 'node:perf_hooks';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {CollectionManager} from '../src/collection.js';import {PARSER_VERSION} from '../src/schema.js';import {ashbyProvider} from '../src/ats/ashby.js';import {normalizeOptions} from '../src/filters.js';
export async function measureBoards(count) {
 const now=Date.now(),stamp=new Date(now).toISOString();let identities=0,requests=0,inventory;
 const boards=Array.from({length:count},(_,i)=>{const id=`board${String(i).padStart(5,'0')}`;return {get id(){identities++;return id;},status:'valid',lastJobFetchAt:stamp};});
 inventory={provider:'Ashby',boards,cursors:{},coverageComplete:true,nextDiscoveryAt:new Date(now+86400000).toISOString()};
 const cache={metrics:{},fresh:record=>!!record,read:async(kind,key)=>kind==='inventory'?{data:inventory}:kind==='postings'?{
  updatedAt:stamp,expiresAt:new Date(now+1200000).toISOString(),data:{parserVersion:PARSER_VERSION,board:{id:key.split(':').at(-1)},complete:true,pages:1,revision:key,lastSuccessfulFetchAt:stamp,jobs:[{source:'Ashby',id:key,title:'Engineer',company:'Employer',description:'Engineer responsibilities',descriptionCompleteness:'complete',url:`https://jobs.ashbyhq.com/example/${key}`,lastObservedAt:stamp}]}
 }:null,put:async(kind,key,data)=>({data,updatedAt:stamp,expiresAt:new Date(now+1200000).toISOString()}),update:async(kind,key,work)=>{inventory=work(inventory);}};
 const original=Array.prototype.findIndex;let comparisons=0,result;
 Array.prototype.findIndex=function(predicate,thisArg){return original.call(this,(...args)=>{comparisons++;return predicate.apply(thisArg,args);});};
 const started=performance.now();
 try{result=await new CollectionManager({cache,http:{json:async()=>{requests++;throw new Error('Unexpected network');}},now:()=>now}).find(ashbyProvider,normalizeOptions({website:'Ashby',search:'Engineer',pages:1}));}
 finally{Array.prototype.findIndex=original;}
 return {boards:count,elapsedMs:Math.round((performance.now()-started)*100)/100,identityReads:identities,arrayComparisons:comparisons,requests,visited:result.stats.boardsVisited,observed:inventory.boards.filter(board=>board.queryStats).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const samples=[];for(const count of [500,1500,3000])samples.push(await measureBoards(count));
 console.log(JSON.stringify({fixture:'In-memory fresh snapshots, one Engineer per board; real CollectionManager; no HTTP/filesystem work',samples},null,2));
}
