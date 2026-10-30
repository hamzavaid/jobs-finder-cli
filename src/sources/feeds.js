import {normalizeJob,plainText} from '../schema.js';
import {publicLink,instant} from '../ats/shared.js';
import {stableKey} from '../cache.js';
export const SOURCE_POLICIES=Object.freeze({Remotive:{ttl:6*3600000,url:'https://remotive.com/api/remote-jobs',terms:'https://github.com/remotive-com/remote-jobs-api',attribution:'Remotive; link to original Remotive URL',redistribution:'Do not syndicate to third-party job boards.'},Himalayas:{ttl:24*3600000,url:'https://himalayas.app/jobs/api',terms:'https://himalayas.app/api',attribution:'Himalayas; retain applicationLink unchanged and source link',redistribution:'Do not syndicate to other job aggregators.'}});
export function normalizeFeed(raw,source) {
 const him=source==='Himalayas',url=publicLink(him?raw.guid||raw.url:raw.url);if(!url||typeof raw.title!=='string'||!raw.title.trim())return null;
 const published=him?(typeof raw.pubDate==='number'?new Date(raw.pubDate*1000).toISOString():raw.pubDate):raw.publication_date;
 const postedAt=instant(published);const description=plainText(raw.description);
 return normalizeJob({source,id:String(raw.id??stableKey(url)),providerJobId:raw.id==null?null:String(raw.id),title:raw.title.trim(),company:him?raw.companyName:raw.company_name,companyEvidence:'observed',url,sourceUrl:url,applicationUrl:him?publicLink(raw.applicationLink):url,description,descriptionCompleteness:description?'complete':'title-only',location:him?(raw.locationRestrictions||[]).join(', ')||null:raw.candidate_required_location||null,workplace:'remote',employmentType:him?raw.employmentType:raw.job_type,seniorityLevel:him?raw.seniority?.join(', ')||null:null,salary:him?(raw.minSalary!=null||raw.maxSalary!=null?{min:raw.minSalary,max:raw.maxSalary,currency:raw.currency,period:raw.salaryPeriod}:null):raw.salary||null,expiresAt:him && typeof raw.expiryDate === 'number' && raw.expiryDate > 0 && raw.expiryDate < 8.64e12 ? new Date(raw.expiryDate*1000).toISOString() : null,postedAt,datePrecision:postedAt?'instant':null,sourcePostedText:published||null,attribution:SOURCE_POLICIES[source].attribution,exportRestrictions:SOURCE_POLICIES[source].redistribution,termsUrl:SOURCE_POLICIES[source].terms});
}
function feedProvider(name){return {name,kind:'feed',searchScoped:name==='Himalayas',cacheTtl:SOURCE_POLICIES[name].ttl,async fetchBoard(board,http,{pages=5,search=''}={}){
 const jobs=new Map();let cursor=null;const seen=new Set();let rejected=0;
 for(let page=0;page<(name==='Remotive'?1:pages);page++){
  const searching=name==='Himalayas' && !!search;const url=new URL(SOURCE_POLICIES[name].url+(searching?'/search':''));if(searching){url.searchParams.set('q',search);url.searchParams.set('page',String(page+1));}else if(name==='Himalayas'){url.searchParams.set('limit','20');if(cursor)url.searchParams.set('cursor',cursor);}
  let data;try{data=await http.json(url.toString());if(!Array.isArray(data?.jobs))throw new Error(`${name} schema drift: jobs array missing.`);}catch(error){if(error.name==='AbortError'||!jobs.size)throw error;return {jobs:[...jobs.values()],pages:page,complete:false,reason:error.message,errorStatus:error.status,retryAt:error.retryAt};}
  const before=jobs.size;
  for(const raw of data.jobs){let job;try{job=normalizeFeed(raw,name);}catch{}if(job)jobs.set(job.id,job);else rejected++;}
  if(searching){if(page>0&&data.jobs.length&&jobs.size===before)return {jobs:[...jobs.values()],pages:page+1,complete:false,reason:'repeated search page'};if(!data.jobs.length || Number.isFinite(data.totalCount) && jobs.size>=data.totalCount)return {jobs:[...jobs.values()],pages:page+1,complete:!rejected,reason:rejected?'malformed records quarantined':null};continue;}
  const next=data.nextCursor;if(name==='Remotive'||!next)return {jobs:[...jobs.values()],pages:page+1,complete:!rejected,reason:rejected?'malformed records quarantined':null};
  if(typeof next!=='string'||next.length>8192||seen.has(next))return {jobs:[...jobs.values()],pages:page+1,complete:false,reason:'invalid or repeated cursor'};seen.add(next);cursor=next;
 }return {jobs:[...jobs.values()],pages,complete:false,reason:'feed page budget reached'};
}};}
export const remotiveProvider=feedProvider('Remotive');
export const himalayasProvider=feedProvider('Himalayas');
