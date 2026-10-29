import {text as clean,assertBoard, posting, publicLink, instant, decodeDescription, observedWorkplace} from './shared.js';

export function greenhouseUrl(board, {content = false, jobId} = {}) {
  const token = assertBoard(board);
  if (jobId !== undefined && !/^\d+$/.test(String(jobId))) throw new Error('Invalid Greenhouse posting ID.');
  const url = new URL(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs${jobId === undefined ? '' : '/' + jobId}`);
  if (content) url.searchParams.set('content','true');
  return url.toString();
}
export function normalizeGreenhouse(raw, board) {
  const metadata = Array.isArray(raw.metadata) ? raw.metadata : [];
  const attribute = names => metadata.find(item => names.includes(String(item.name || '').toLowerCase()))?.value;
  const postedAt = instant(raw.first_published);
  return posting('Greenhouse',board,raw,{
    title:clean(raw.title) || null, location:clean(raw.location?.name) || null,
    url:publicLink(raw.absolute_url), description:decodeDescription(raw.content),
    workplace:observedWorkplace(attribute(['workplace type','workplace']),raw.location?.name),
    employmentType:typeof attribute(['employment type','job type']) === 'string' ? attribute(['employment type','job type']) : null,
    seniorityLevel:typeof attribute(['seniority level','experience level']) === 'string' ? attribute(['seniority level','experience level']) : null,
    salary:raw.pay_input_ranges || null, postedAt, datePrecision:postedAt ? 'instant' : null,
    updatedAt:instant(raw.updated_at), requisitionId:raw.requisition_id || null,
    detailsFetched:!!raw.content
  });
}
export const greenhouseProvider = {
  enrichJob(board,job,http) {return this.fetchDetail(board,job.providerJobId,http);},
  name:'Greenhouse', kind:'ats', domains:['boards.greenhouse.io','job-boards.greenhouse.io'], apiUrl:greenhouseUrl,
  async fetchCompany(board,http) {
    const data = await http.json(`https://boards-api.greenhouse.io/v1/boards/${assertBoard(board)}`);
    if (typeof data?.name !== 'string' || !data.name.trim()) throw new Error('Greenhouse returned invalid board metadata.');
    return clean(data.name);
  },
  async fetchBoard(board, http, options = {}) {
    const data = await http.json(greenhouseUrl(board,{content:!!options.content}));
    if (!data || !Array.isArray(data.jobs)) throw new Error('Greenhouse returned an invalid jobs payload.');
    const jobs = data.jobs.map(raw => normalizeGreenhouse(raw,board)).filter(Boolean);
    if (jobs.length !== data.jobs.length) throw new Error('Greenhouse returned malformed posting records; cache preserved.');
    return {jobs,complete:true,pages:1};
  },
  async fetchDetail(board, id, http) {
    const data = await http.json(greenhouseUrl(board,{jobId:id}));
    if (String(data?.id) !== String(id)) throw new Error('Greenhouse detail posting ID mismatch.');
    const job = normalizeGreenhouse(data,board);
    if (!job) throw new Error('Greenhouse returned an invalid detail payload.');
    return {...job,detailsFetched:true,apiDetailsFetched:true};
  }
};
