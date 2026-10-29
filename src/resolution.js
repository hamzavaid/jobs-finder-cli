import robotsParser from 'robots-parser';import {canonicalizeUrl,createPublicHttp} from './public-http.js';import {parsePosting} from './posting-parser.js';import {extractBoard} from './discovery.js';import {CacheManager} from './cache.js';import {greenhouseProvider} from './ats/greenhouse.js';import {leverProvider} from './ats/lever.js';import {ashbyProvider} from './ats/ashby.js';import {smartRecruitersProvider} from './ats/smartrecruiters.js';import {personioProvider} from './ats/personio.js';
const adapters=[greenhouseProvider,leverProvider,ashbyProvider,smartRecruitersProvider,personioProvider];
export class PostingResolver {
 constructor({http=createPublicHttp(),apiHttp,cache=new CacheManager(),signal}={}){Object.assign(this,{http,apiHttp,cache,signal});this.pending=new Map();this.robots=new Map();}
 async resolve(value,depth=0){if(depth>1)return {status:'unsupported',job:null,error:'Resolution hop budget reached.'};let url;try{url=canonicalizeUrl(value);}catch(error){return {status:'unsupported',job:null,error:error.message};}if(this.pending.has(url))return this.pending.get(url);const work=this.resolveOnce(url,value,depth);this.pending.set(url,work);try{return await work;}finally{this.pending.delete(url);}}
 async resolveOnce(url,discoveryUrl,depth){
  try {this.signal?.throwIfAborted();const cached=await this.cache.read('resolution',url);if(this.cache.fresh(cached))return {...cached.data,cacheHit:true};
   let result;
   for(const provider of this.apiHttp?adapters:[]){const board=extractBoard(url,provider);if(!board)continue;const parts=new URL(url).pathname.split('/').filter(Boolean);const index=provider.name==='Greenhouse'?parts.indexOf('jobs')+1:provider.name==='Personio'?parts.indexOf('job')+1:1;const id=parts[index]?.split('-')[0];const fullId=provider.name==='Lever'||provider.name==='Ashby'?parts[1]:id;
    if(provider.fetchDetail&&fullId)result={job:await provider.fetchDetail(board,fullId,this.apiHttp)};
    else if(provider.name==='Lever'&&fullId)result={job:await provider.enrichJob(board,{id:`${board.region}:${board.id.toLowerCase()}:${fullId}`,providerJobId:fullId},this.apiHttp)};
    else if(provider.name==='SmartRecruiters'&&fullId)result={job:await provider.enrichJob(board,{id:`${board.region}:${board.id.toLowerCase()}:${fullId}`,providerJobId:fullId},this.apiHttp)};
    else {const response=await provider.fetchBoard(board,this.apiHttp,{pages:1,content:true});result={job:response.jobs.find(job=>job.providerJobId===fullId)||null};}
    if(result.job){result.status=result.job.title&&result.job.company&&result.job.description?'complete':'incomplete';break;}
   }
   if(!result?.job){const origin=new URL(url).origin,robotsUrl=origin+'/robots.txt';if(!this.robots.has(origin))this.robots.set(origin,this.http.get(robotsUrl,{robots:true}).then(body=>robotsParser(robotsUrl,body)));const rules=await this.robots.get(origin);if(rules.isAllowed(url,'jobs-finder-cli')===false)return await this.remember(url,{status:'blocked',job:null,error:'robots.txt disallows this posting.'});result=parsePosting(await this.http.get(url),url);if(!result.job&&depth===0){const target=result.links.find(link=>adapters.some(provider=>extractBoard(link,provider)));if(target&&target!==url)result=await this.resolve(target,depth+1);}}
   if(result.job)result.job={...result.job,discoveryUrl,resolutionStatus:result.status,provenance:[...(result.job.provenance||[]),{source:'discovery',url:discoveryUrl,method:'posting-resolution'}]};return await this.remember(url,result);
  }catch(error){if(error.name==='AbortError'||this.signal?.aborted)throw error;return this.remember(url,{status:[401,403,429].includes(error.status)?'blocked':'failed',job:null,error:error.message});}
 }
 async remember(url,result){try{await this.cache.put('resolution',url,result,{ttl:result.status==='complete'?6*3600000:15*60000});}catch(error){if(error.name==='AbortError')throw error;result.warning=`Resolution cache unavailable: ${error.message}`;}return result;}
}
