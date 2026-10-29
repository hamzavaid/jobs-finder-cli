import {createHash} from 'node:crypto';
import {load} from 'cheerio';

export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const plainText = value => typeof value === 'string' ? clean(load(value).text()) || null : null;
export const JOB_SCHEMA_VERSION = 2;
export const PARSER_VERSION = 5;
export function validSourceDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:?\d{2}))?$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
 const day=value.slice(0,10);return new Date(Date.parse(day)).toISOString().slice(0,10)===day;
}
export function normalizeJob(job) {
  const stamp = new Date().toISOString();
  const normalized = {schemaVersion:JOB_SCHEMA_VERSION,parserVersion:PARSER_VERSION,source:null,provider:job.source || null,id:null,providerJobId:null,boardId:null,region:null,requisitionId:null,title:null,company:null,employer:null,employerIdentity:null,companyEvidence:job.company ? 'observed' : null,location:null,secondaryLocations:[],url:null,canonicalUrl:job.url||null,applicationUrl:job.applyUrl||job.url||null,
    sourceUrl:null,postedAt:null,updatedAt:null,createdAt:null,datePrecision:null,postedText:null,workplace:null,
    employmentType:null,seniorityLevel:null,salary:null,salaryCurrency:null,salaryPeriod:null,description:null,
    applicantCount:null,underTenApplicants:null,verified:null,verificationStatus:job.verified===true?'verified':job.verified===false?'unverified':'unknown',detailsFetched:false,
    descriptionCompleteness:job.description ? (job.detailsFetched ? 'complete' : 'partial') : 'title-only',firstSeenAt:stamp,lastSeenAt:stamp,lastObservedAt:stamp,provenance:job.source?[{source:job.source,url:job.sourceUrl||job.url||null,method:'provider'}]:[],resolutionStatus:job.description&&job.title&&job.company?'complete':'incomplete',cacheStatus:null,fetchedAt:stamp,...job};
  normalized.employer = normalized.company;
  normalized.employerIdentity ||= normalized.companyEvidence === 'observed' ? {name:normalized.company,evidence:'observed-name'} : null;
  for(const key of ['postedAt','updatedAt','createdAt']) if(normalized[key]!=null&&!validSourceDate(normalized[key]))normalized[key]=null;
  if(!normalized.postedAt)normalized.datePrecision=null;
  const salary=normalized.salary;
  if(salary&&typeof salary==='object'&&!Array.isArray(salary)) {
    const value=salary.value && typeof salary.value === 'object' ? salary.value : salary;
    const min=value.min??value.minValue??(typeof salary.value === 'number' ? salary.value : undefined),max=value.max??value.maxValue;
    if([min,max].some(v=>v!=null&&(typeof v!=='number'||!Number.isFinite(v)||v<0)) || min!=null&&max!=null&&min>max)normalized.salary=null;
    else {normalized.salaryCurrency=/^[A-Z]{3}$/.test(salary.currency)?salary.currency:null;const period=String(salary.period||salary.unitText||value.unitText||'').toLowerCase();normalized.salaryPeriod=['hour','day','week','month','year','annual','hourly','monthly','yearly'].includes(period)?period:null;}
  }
  normalized.rawContentHash = createHash('sha256').update(JSON.stringify([normalized.title,normalized.company,normalized.description,normalized.location,normalized.workplace,normalized.employmentType,normalized.postedAt,normalized.salary])).digest('hex');
  return normalized;
}
export function validateJob(job,{complete=false}={}) {
 const errors=[];
 for(const field of ['source','id','title'])if(typeof job?.[field]!=='string'||!job[field].trim())errors.push(field);
 try {const url=new URL(job?.url);if(url.protocol!=='https:'||url.username||url.password||url.port)errors.push('url');}catch{errors.push('url');}
 if(complete)for(const field of ['company','description'])if(typeof job?.[field]!=='string'||!job[field].trim())errors.push(field);
 if(job?.applicantCount!=null&&(!Number.isInteger(job.applicantCount)||job.applicantCount<0))errors.push('applicantCount');
 return {valid:!errors.length,errors,schemaVersion:JOB_SCHEMA_VERSION};
}
export function structuredJobs(html) {
  const $ = load(html || ''), jobs = [];
  let remaining=20000;
  function visit(value,depth=0) {
    if (!value || typeof value !== 'object' || depth>24 || --remaining<0) return;
    if (Array.isArray(value)) {for(const item of value.slice(0,5000))visit(item,depth+1);return;}
    if ([value['@type']].flat().includes('JobPosting')) jobs.push(value);
    if (value['@graph']) visit(value['@graph'],depth+1);
    if (Array.isArray(value.itemListElement)) value.itemListElement.slice(0,5000).forEach(item => visit(item?.item || item,depth+1));
    if (value.mainEntity) visit(value.mainEntity,depth+1);
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    const text=$(el).html();if(!text || text.length>4*1024*1024)return;
    try {visit(JSON.parse(text));} catch { /* Invalid metadata is not executable. */ }
  });
  return jobs;
}
export function structuredFields(ld = {}) {
  const location = [ld.jobLocation].flat().filter(Boolean).map(item => {
    const a = item.address;
    return a ? [a.addressLocality,a.addressRegion,a.addressCountry?.name || a.addressCountry].filter(x => typeof x === 'string').join(', ') : item.name;
  }).filter(Boolean).join('; ') || null;
  const validDate = validSourceDate(ld.datePosted);
  return {title:typeof ld.title === 'string' ? clean(ld.title) || null : null, company:typeof ld.hiringOrganization?.name === 'string' ? clean(ld.hiringOrganization.name) || null : null,
    description:plainText(ld.description), location,
    postedAt:validDate ? ld.datePosted : null,
    datePrecision:validDate ? (ld.datePosted.length === 10 ? 'day' : 'instant') : null,
    employmentType:Array.isArray(ld.employmentType) ? ld.employmentType.join(', ') : ld.employmentType || null,
    seniorityLevel:typeof ld.experienceRequirements === 'string' ? ld.experienceRequirements : null,
    workplace:ld.jobLocationType === 'TELECOMMUTE' ? 'remote' : null,
    salary:ld.baseSalary || null};
}
export function mergeKnown(fallback, fields) {
  return {...fallback, ...Object.fromEntries(Object.entries(fields).filter(([,v]) => v !== null && v !== undefined && v !== ''))};
}
