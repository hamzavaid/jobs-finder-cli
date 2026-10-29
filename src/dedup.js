import {canonicalizeUrl} from './public-http.js';import {normalizeCompany} from './filters.js';import {normalizeText,tokenize} from './relevance.js';
const identity=job=>[job.source,job.region||'global',job.boardId||'',job.providerJobId||job.id].join(':');
const conflict=(a,b)=>!!(company(a)&&company(b)&&company(a)!==company(b)||a.requisitionId&&b.requisitionId&&a.requisitionId!==b.requisitionId);
const company=job=>normalizeCompany(job.company||job.employer);
function specificUrl(job){try{const url=new URL(canonicalizeUrl(job.canonicalUrl||job.url));if(!/\d{4,}|[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(url.pathname)&&![...url.searchParams.keys()].some(key=>/^(?:jk|jl|gh_jid|job_?id|requisitionId)$/i.test(key)))return null;return url.toString();}catch{return null;}}
function compatible(a,b){return !!company(a)&&company(a)===company(b)&&!(a.requisitionId&&b.requisitionId&&a.requisitionId!==b.requisitionId);}
function verifiedEmployer(job){const value=job.employerIdentity;return value?.id&&(value.verified===true||value.evidence==='verified-domain')?String(value.id):null;}
function quality(job){return (job.descriptionCompleteness==='complete'?100:0)+(job.description?10:0)+(['Greenhouse','Lever','Ashby','SmartRecruiters','Personio','Employer'].includes(job.source)?20:0)+(job.companyEvidence==='observed'?5:0);}
function merge(a,b){const [best,other]=quality(a)>quality(b)||quality(a)===quality(b)&&identity(a).localeCompare(identity(b))<=0?[a,b]:[b,a];const originals=[...(a.originalRecords||[a]),...(b.originalRecords||[b])].map(({originalRecords,...row})=>row);return {...other,...best,originalRecords:originals,provenance:[...(a.provenance||[{source:a.source,url:a.url}]),...(b.provenance||[{source:b.source,url:b.url}])]};}
export function consolidateJobs(jobs,{consolidate=true}={}) {
 const exact=new Map(),strong=new Map(),links=new Map(),buckets=new Map(),output=[];let confirmed=0,possible=0,conflicts=0;
 for(const job of jobs){let index=exact.get(identity(job));const url=specificUrl(job),employer=verifiedEmployer(job),requisition=employer&&job.requisitionId?`${employer}:${job.requisitionId}`:null;
  if(index===undefined&&requisition)index=strong.get(requisition);
  if(index===undefined&&url){const candidate=links.get(url);if(candidate!==undefined){const other=output[candidate];if(conflict(other,job)){conflicts++;}else if(job.companyEvidence==='observed'&&other.companyEvidence==='observed')index=candidate;}}
  if(index!==undefined&&!conflict(output[index],job)&&consolidate){output[index]=merge(output[index],job);confirmed++;exact.set(identity(job),index);if(url)links.set(url,index);if(requisition)strong.set(requisition,index);continue;}
  let row=job;const linked=url?links.get(url):undefined;
  if(linked!==undefined&&output[linked].source!==job.source&&!conflict(output[linked],job)){row={...job,possibleDuplicateOf:`${output[linked].source}:${output[linked].id}`};possible++;}
  else {const key=[company(job),normalizeText(job.title),normalizeText(job.location)].join('|');const candidates=buckets.get(key)||[];if(company(job)&&job.description){const terms=new Set(tokenize(job.description));const candidate=candidates.find(i=>{const other=output[i];if(!compatible(other,job)||other.source===job.source||!other.description)return false;const words=new Set(tokenize(other.description));const shared=[...terms].filter(t=>words.has(t)).length;return shared/Math.max(terms.size,words.size,1)>=.9;});if(candidate!==undefined){row={...job,possibleDuplicateOf:`${output[candidate].source}:${output[candidate].id}`};possible++;}}
   if(candidates.length<20)candidates.push(output.length);buckets.set(key,candidates);
  }
  const at=output.length;output.push(row);exact.set(identity(job),at);if(url&&!links.has(url))links.set(url,at);if(requisition&&!strong.has(requisition))strong.set(requisition,at);
 }
 return {jobs:output,possible,confirmed,conflicts};
}
/** Backward-compatible conservative hints for callers that keep all source rows. */
export const identifyCrossSourceDuplicates=jobs=>consolidateJobs(jobs,{consolidate:false});
