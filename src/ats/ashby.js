import {text as clean,assertBoard, posting, publicLink, instant, decodeDescription} from './shared.js';
import {normalizeWorkplace} from '../filters.js';

export function ashbyUrl(board,{compensation = true} = {}) {
  const url = new URL(`https://api.ashbyhq.com/posting-api/job-board/${assertBoard(board)}`);
  if (compensation) url.searchParams.set('includeCompensation','true');
  return url.toString();
}
export function normalizeAshby(raw,board) {
  if (raw.isListed === false) return null;
  const postedAt = instant(raw.publishedAt);
  const location = clean(raw.location) || null;
  // isRemote=true can also describe hybrid work; without a specific type it is unknown.
  const workplace = normalizeWorkplace(raw.workplaceType) || normalizeWorkplace(location);
  return posting('Ashby',board,raw,{
    title:clean(raw.title) || null,location,url:publicLink(raw.jobUrl),applyUrl:publicLink(raw.applyUrl),
    secondaryLocations:Array.isArray(raw.secondaryLocations) ? raw.secondaryLocations.map(item => clean(item.location)).filter(Boolean) : [],
    workplace, remoteEligible:typeof raw.isRemote === 'boolean' ? raw.isRemote : null,
    employmentType:clean(raw.employmentType) || null,seniorityLevel:clean(raw.seniorityLevel) || null,
    description:raw.descriptionPlain || decodeDescription(raw.descriptionHtml),
    salary:raw.compensation || null,postedAt,datePrecision:postedAt ? 'instant' : null,
    department:clean(raw.department) || null,team:clean(raw.team) || null,detailsFetched:true
  });
}
export const ashbyProvider = {
  async enrichJob(board,job) {return job;},
  name:'Ashby',kind:'ats',domains:['jobs.ashbyhq.com'],apiUrl:ashbyUrl,
  async fetchBoard(board,http) {
    const data = await http.json(ashbyUrl(board));
    if (!data || !Array.isArray(data.jobs)) throw new Error('Ashby returned an invalid jobs payload.');
    const jobs = [];let rejected=0;
    for (const raw of data.jobs) {
      if (raw?.isListed === false) continue;
      let job;try{job = normalizeAshby(raw,board);}catch{};
      if (!job) {rejected++;continue;}
      jobs.push(job);
    }
    return {jobs,complete:!rejected,pages:1,rejected,reason:rejected?'schema drift: malformed records quarantined':null};
  }
};
