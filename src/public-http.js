import https from 'node:https';import {lookup as dnsLookup} from 'node:dns';import {isIP,BlockList} from 'node:net';import {RequestScheduler} from './concurrency.js';
const denied=new BlockList();
for(const [base,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(base,prefix,'ipv4');
const global6=new BlockList();global6.addSubnet('2000::',3,'ipv6');denied.addSubnet('2001:db8::',32,'ipv6');denied.addSubnet('2001::',32,'ipv6');denied.addSubnet('2002::',16,'ipv6');
export function isPublicAddress(ip){const family=isIP(ip);return family===4?!denied.check(ip,'ipv4'):family===6&&global6.check(ip,'ipv6')&&!denied.check(ip,'ipv6');}
export function canonicalizeUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.toString().length>8192||url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local')||isIP(url.hostname.replace(/^\[|\]$/g,''))&&!isPublicAddress(url.hostname.replace(/^\[|\]$/g,'')))throw new Error('Unsafe public posting URL.');url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:trackingId|trk|source|ref)$/i.test(key))url.searchParams.delete(key);url.searchParams.sort();return url.toString();}
export function createPublicHttp({signal,timeoutMs=15000,maxBytes=4*1024*1024,lookup=dnsLookup,scheduler=new RequestScheduler({signal})}={}) {
 const last=new Map();
 return {async get(value,{robots=false}={}){const url=new URL(canonicalizeUrl(value));return scheduler.run(url.hostname,async()=>{
  const wait=Math.max(0,(last.get(url.hostname)||0)+1200-Date.now());if(wait)await new Promise((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},wait);signal?.addEventListener('abort',onAbort,{once:true});});signal?.throwIfAborted();last.set(url.hostname,Date.now());
  return new Promise((resolve,reject)=>{
   const request=https.request(url,{method:'GET',agent:false,signal,headers:{'User-Agent':'jobs-finder-cli/2.0 (public job posting resolver)',Accept:'text/html,text/plain,application/xml'},lookup(host,options,callback){lookup(host,{all:true,verbatim:true},(error,addresses)=>{if(error)return callback(error);if(!addresses?.length||addresses.some(item=>!isPublicAddress(item.address)))return callback(new Error('Private or reserved DNS destination rejected.'));if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);});}},response=>{
    if(robots&&response.statusCode===404){response.resume();resolve('');return;}
    if(response.statusCode!==200){response.resume();reject(Object.assign(new Error(`Public posting HTTP ${response.statusCode}; redirects are not followed.`),{status:response.statusCode}));return;}
    const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)request.destroy(new Error('Public posting exceeds response-size limit.'));else chunks.push(chunk);});response.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));response.on('error',reject);
   });const timer=setTimeout(()=>request.destroy(new Error('Public posting timeout.')),timeoutMs);request.on('close',()=>clearTimeout(timer));request.on('error',reject);request.end();
  });
 });}};
}
