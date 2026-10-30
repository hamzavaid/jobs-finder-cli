import {assertBoard,posting,publicLink,instant,text,decodeDescription} from './shared.js';
export function smartRecruitersUrl(board,{offset=0,limit=100,jobId}={}) {
 const token=assertBoard(board);if(jobId!==undefined&&!/^[\w-]+$/.test(String(jobId))) throw new Error('Invalid posting ID.');
 const url=new URL(`https://api.smartrecruiters.com/v1/companies/${token}/postings${jobId ? '/'+jobId : ''}`);
 if(!jobId) {url.searchParams.set('limit',limit);url.searchParams.set('offset',offset);url.searchParams.set('destination','PUBLIC');}return url.toString();
}
export function normalizeSmartRecruiters(raw,board) {
 if(raw.visibility && raw.visibility!=='PUBLIC') return null;
 const description=Object.values(raw.jobAd?.sections || {}).map(section=>decodeDescription(section.text)).filter(Boolean).join('\n') || null;
 const postedAt=instant(raw.releasedDate);
 return posting('SmartRecruiters',{...board,company:raw.company?.name||board.company},raw,{title:text(raw.name),url:publicLink(raw.postingUrl)||`https://jobs.smartrecruiters.com/${assertBoard(board)}/${encodeURIComponent(raw.id)}`,location:text(raw.location?.fullLocation)||[raw.location?.city,raw.location?.region,raw.location?.country].filter(Boolean).join(', ')||null,description,descriptionCompleteness:description?'complete':'title-only',postedAt,datePrecision:postedAt?'instant':null,workplace:raw.location?.hybrid===true?'hybrid':raw.location?.remote===true?'remote':null,employmentType:text(raw.typeOfEmployment?.label)||null,seniorityLevel:text(raw.experienceLevel?.label)||null,requisitionId:text(raw.refNumber)||null});
}
export const smartRecruitersProvider={name:'SmartRecruiters',kind:'ats',domains:['jobs.smartrecruiters.com','careers.smartrecruiters.com'],apiUrl:smartRecruitersUrl,
 async fetchBoard(board,http,{pages=5}={}) {
  const jobs=new Map();let rejected=0;
  for(let page=0;page<pages;page++) {
   let data;try{data=await http.json(smartRecruitersUrl(board,{offset:page*100}));if(!Array.isArray(data?.content))throw new Error('SmartRecruiters schema drift: content array missing.');}catch(error){if(error.name==='AbortError'||!jobs.size)throw error;return {jobs:[...jobs.values()],pages:page,complete:false,reason:error.message,errorStatus:error.status,retryAt:error.retryAt};}
   let fresh=0;
   for(const raw of data.content){let job;try{job=normalizeSmartRecruiters(raw,board);}catch{}if(!job){rejected++;continue;}if(!jobs.has(job.id)){jobs.set(job.id,job);fresh++;}}
   if(data.content.length<100 || Number.isFinite(data.totalFound)&&page*100+data.content.length>=data.totalFound)return {jobs:[...jobs.values()],pages:page+1,complete:!rejected,reason:rejected?'malformed records quarantined':null};
   if(!fresh)return {jobs:[...jobs.values()],pages:page+1,complete:false,reason:'repeated page'};
  }return {jobs:[...jobs.values()],pages,complete:false,reason:'page budget'};
 },
 async enrichJob(board,job,http){const raw=await http.json(smartRecruitersUrl(board,{jobId:job.providerJobId}));const full=normalizeSmartRecruiters(raw,board);if(!full||full.id!==job.id)throw new Error('SmartRecruiters detail identity mismatch.');return {...full,apiDetailsFetched:true};}
};
