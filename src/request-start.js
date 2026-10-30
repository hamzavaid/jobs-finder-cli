import {setTimeout as delay} from 'node:timers/promises';
/** Serialize start reservations per host, independently of response concurrency. */
export function createStartGate({delayMs=1200,now=Date.now,signal,sleep=ms=>delay(ms,undefined,{signal})}={}) {
 const gates=new Map(),next=new Map();
 return async host=>{
  const start=(gates.get(host)||Promise.resolve()).catch(()=>{}).then(async()=>{
   signal?.throwIfAborted();const wait=Math.max(0,(next.get(host)||0)-now());
   if(wait)await sleep(wait);
   signal?.throwIfAborted();next.set(host,now()+delayMs);
  });
  gates.set(host,start);
  try{await start;}finally{if(gates.get(host)===start)gates.delete(host);}
 };
}
