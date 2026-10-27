import {clean} from '../schema.js';
import {assertBoard, posting, publicLink, decodeDescription, observedWorkplace} from './shared.js';

export function leverUrl(board, {skip = 0, limit = 100, jobId} = {}) {
  const token = assertBoard(board);
  if (jobId !== undefined && !/^[\w-]{1,128}$/.test(String(jobId))) throw new Error('Invalid Lever posting ID.');
  const url = new URL(`https://api${board.region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${token}${jobId ? '/' + encodeURIComponent(jobId) : ''}`);
  url.searchParams.set('mode','json');
  if (!jobId) {url.searchParams.set('skip',String(skip)); url.searchParams.set('limit',String(limit));}
  return url.toString();
}
export function normalizeLever(raw, board) {
  const description = [raw.descriptionPlain || decodeDescription(raw.description),
    ...(Array.isArray(raw.lists) ? raw.lists.map(item => [item.text,decodeDescription(item.content)].filter(Boolean).join(': ')) : []),
    raw.additionalPlain || decodeDescription(raw.additional)].filter(Boolean).join('\n') || null;
  const created = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0 && raw.createdAt < 8.64e15 ? new Date(raw.createdAt).toISOString() : null;
  return posting('Lever',board,raw,{
    title:clean(raw.text) || null, location:clean(raw.categories?.location) || null,
    url:publicLink(raw.hostedUrl), applyUrl:publicLink(raw.applyUrl), description,
    workplace:observedWorkplace(raw.workplaceType,raw.categories?.location),
    employmentType:clean(raw.categories?.commitment) || null, seniorityLevel:clean(raw.categories?.level) || null,
    department:clean(raw.categories?.department) || null, team:clean(raw.categories?.team) || null,
    salary:raw.salaryRange || raw.salaryDescriptionPlain || null,
    postedAt:null,datePrecision:null,createdAt:created,detailsFetched:true
  });
}
export const leverProvider = {
  name:'Lever',kind:'ats',domains:['jobs.lever.co','jobs.eu.lever.co'],apiUrl:leverUrl,
  async fetchBoard(board,http,{pages = 5} = {}) {
    const jobs = new Map();
    for (let page = 0; page < pages; page++) {
      const data = await http.json(leverUrl(board,{skip:page * 100}));
      if (!Array.isArray(data)) throw new Error('Lever returned an invalid postings array.');
      let fresh = 0;
      for (const raw of data) {
        const job = normalizeLever(raw,board);
        if (!job) throw new Error('Lever returned malformed posting records; cache preserved.');
        if (!jobs.has(job.id)) {fresh++; jobs.set(job.id,job);}
      }
      if (data.length < 100) return {jobs:[...jobs.values()],complete:true,pages:page + 1};
      if (!fresh) return {jobs:[...jobs.values()],complete:false,pages:page + 1,reason:'repeated API page'};
    }
    return {jobs:[...jobs.values()],complete:false,pages,reason:'API page limit reached'};
  }
};
