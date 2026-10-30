/** Indeed public HTML reader. Does not impersonate browsers, login, bypass challenges, or use hidden APIs. */
import {load} from 'cheerio';
import {normalizeWorkplace} from './filters.js';
import {searchProvider} from './provider-search.js';
import {structuredJobs, structuredFields, mergeKnown, normalizeJob,validSourceDate,plainText} from './schema.js';
import {assertPublicHtml} from './http.js';
import {policyHttp} from './provider-access.js';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const textValue = value => typeof value === 'string' || typeof value === 'number' ? clean(value)
  : value && typeof value === 'object' ? clean(value.text ?? value.displayName ?? value.name ?? '') : '';
const pick = (obj, keys) => keys.map(k => textValue(obj?.[k])).find(Boolean) || null;
const typeMap = {
  'full-time':'fulltime', fulltime:'fulltime', 'part-time':'parttime', parttime:'parttime',
  contract:'contract', temporary:'temporary', internship:'internship', intern:'internship'
};
const expMap = {entry:'entry_level', 'entry-level':'entry_level', junior:'entry_level',
  mid:'mid_level', senior:'senior_level', 'mid-senior':'senior_level'};

/** Indeed's UI offers date buckets rather than LinkedIn's exact seconds filter. Choose the smallest >= requested interval. */
export function indeedDateBucket(seconds) {
  if (!seconds || seconds > 14 * 86400) return null;
  return [1, 3, 7, 14].find(d => d * 86400 >= seconds) ?? null;
}
export function indeedFacets(o) {
  // URL hints do not prove that the server honored a requested criterion.
  void o;return [];
}
export function makeIndeedUrl(o, start = 0) {
  const url = new URL('https://www.indeed.com/jobs');
  if (o.search || o.company) url.searchParams.set('q', o.search || `company:${o.company}`);
  if (o.location) url.searchParams.set('l', o.location);
  if (o.company) url.searchParams.set('rbc', o.company);
  const bucket = indeedDateBucket(o.dateSeconds);
  if (bucket) url.searchParams.set('fromage', String(bucket));
  if (o.employment && typeMap[o.employment]) url.searchParams.set('jt', typeMap[o.employment]);
  if (o.experience && expMap[o.experience]) url.searchParams.set('explvl', expMap[o.experience]);
  const work = o.workplace || (o.remote === true ? 'remote' : null);
  if (work === 'remote') url.searchParams.set('sc', '0kf:attr(DSQF7);');
  if (work === 'hybrid') url.searchParams.set('sc', '0kf:attr(PAXZC);');
  if (o.sort === 'recent') url.searchParams.set('sort', 'date');
  if (start) url.searchParams.set('start', String(start));
  return url.toString();
}

/** JSON-only balanced-brace extraction; never evaluate untrusted JavaScript from a remote page. */
export function extractJsonAssignment(html, marker) {
  if(typeof html!=='string'||html.length>16*1024*1024) return null;
  const hit = marker.exec(html);
  if (!hit) return null;
  let start = hit.index + hit[0].length;
  while (/\s/.test(html[start] || '') && start < html.length) start++;
  if (html[start] !== '{' && html[start] !== '[') return null;
  const stack = [];
  let string = false, escape = false;
  for (let i = start; i < html.length; i++) {
    if(i-start>4*1024*1024 || stack.length>32) return null;
    const c = html[i];
    if (string) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') string = false;
      continue;
    }
    if (c === '"') {string = true; continue;}
    if (c === '{' || c === '[') stack.push(c);
    if (c === '}' || c === ']') {
      if (stack.pop() !== (c === '}' ? '{' : '[')) return null;
      if (!stack.length) {
        try {return JSON.parse(html.slice(start, i + 1));} catch {return null;}
      }
    }
  }
  return null;
}
const MOSAIC = /window\.mosaic\.providerData\[\s*["']mosaic-provider-jobcards["']\s*\]\s*=\s*/;
const INITIAL = /window\._initialData\s*=\s*/;
function candidateArrays(obj, depth = 0,budget={remaining:20000}) {
  if (!obj || typeof obj !== 'object' || depth > 7 || --budget.remaining<0) return [];
  if (Array.isArray(obj)) {
    if (obj.some(x => x && typeof x === 'object' && (x.jk || x.jobkey || x.jobKey) && (x.title || x.jobTitle))) return [obj];
    return obj.slice(0,5000).flatMap(x => candidateArrays(x, depth + 1,budget));
  }
  return Object.entries(obj).filter(([key]) => !['query','filters','facets','translations','tracking'].includes(key))
    .slice(0,5000).flatMap(([,value]) => candidateArrays(value, depth + 1,budget));
}
function parseDate(value) {
  if (value == null || value === '') return {postedAt:null, datePrecision:null};
  if (typeof value === 'number') {
    const t = value < 1e11 ? value * 1000 : value;
    if (t > 0 && t < Date.now() + 86400000) return {postedAt:new Date(t).toISOString(), datePrecision:'instant'};
  }
  if (typeof value === 'string' && validSourceDate(value)) {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return {postedAt: value.length === 10 ? value : new Date(time).toISOString(), datePrecision: value.length === 10 ? 'day' : 'instant'};
  }
  return {postedAt:null, datePrecision:null};
}
function canonicalIndeedId(value) {
  return /^[a-z0-9]{8,40}$/i.test(String(value ?? '')) ? String(value) : null;
}
export function indeedJobId(value) {
  if (canonicalIndeedId(value) && !/^https?:/i.test(value)) return String(value);
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['indeed.com','www.indeed.com'].includes(u.hostname) || u.username || u.password || u.port || !/^\/(?:viewjob|rc\/clk|pagead\/clk)$/.test(u.pathname)) throw new Error('Not an Indeed URL');
    const id = u.searchParams.get('jk') || u.searchParams.get('vjk');
    if (canonicalIndeedId(id)) return id;
  } catch { /* invalid; handled below */ }
  throw new Error('Expected an Indeed job key (jk) or Indeed viewjob URL.');
}
export function parseIndeedObject(job) {
  if (!job || typeof job !== 'object') return null;
  const id = canonicalIndeedId(job.jk ?? job.jobkey ?? job.jobKey ?? job.id);
  const title = pick(job, ['title', 'jobTitle', 'displayTitle']);
  const company = pick(job, ['company', 'companyName', 'companyDisplayName', 'sourceEmployerName']);
  if (!id || !title || !company) return null;
  const posted = parseDate(job.datePublished ?? job.datePosted ?? job.pubDate);
  const rawLocation = pick(job, ['formattedLocation','location','jobLocation','jobLocationCity','formattedLocationShort','locationName']);
  const workplace = normalizeWorkplace(pick(job, ['remoteLocation','workplaceType','locationType','remoteType'])) || normalizeWorkplace(rawLocation);
  const taxonomy = Array.isArray(job.taxonomyAttributes) ? job.taxonomyAttributes : [];
  const jobTypes = taxonomy.filter(t => /job[- ]types/i.test(t.label || ''))
    .flatMap(t => (t.attributes || []).map(a => a.label)).filter(Boolean);
  const employmentType = pick(job, ['employmentType','jobType']) || jobTypes[0] || null;
  return {
    source:'Indeed', id, title, company, location:rawLocation,
    url:`https://www.indeed.com/viewjob?jk=${encodeURIComponent(id)}`,
    sourceUrl:null, postedAt:posted.postedAt, datePrecision:posted.datePrecision,
    indexedAt:parseDate(job.dateOnIndeed).postedAt,remoteSignal:typeof job.isRemote==='boolean'?job.isRemote:null,
    postedText:pick(job, ['formattedRelativeTime','formattedDate','date','age','relativeTime']) || null,
    companyLogo:pick(job, ['companyLogoUrl']) || null,
    workplace, employmentType, seniorityLevel:pick(job,['experienceLevel']) || null,
    jobFunction:null, industries:null, description:plainText(pick(job,['description','jobDescription','snippet'])) || null,
    salary:pick(job,['salaryText','salarySnippet']),salarySource:pick(job,['salaryText','salarySnippet'])?'source-displayed':null,
    applicantsText:null, applicantCount:null, underTenApplicants:null, verified:null,
    fetchedAt:new Date().toISOString(), detailsFetched:false
  };
}
export function parseIndeedCards(html) {
  assertPublicHtml(html);
  const budget={remaining:20000};
  const candidates=[MOSAIC,INITIAL].flatMap(marker=>candidateArrays(extractJsonAssignment(html,marker),0,budget).flat().slice(0,2500));
  const rows=candidates.map(parseIndeedObject).filter(Boolean);
  let schemaRejected=candidates.length-rows.length;
  const structured=new Map(),conflictingIds=new Set();
  for(const row of rows) {
    const previous=structured.get(row.id);
    if(previous && ['title','company'].some(key=>clean(previous[key]).toLowerCase()!==clean(row[key]).toLowerCase())) {conflictingIds.add(row.id);schemaRejected++;}
    else structured.set(row.id,mergeKnown(row,previous||{}));
  }
  rows.length=0;rows.push(...structured.values());
  const $ = load(html || '');
  $('[data-jk], a[href*="jk="]').each((_, el) => {
    const element = $(el);
    const root = element.closest('[data-jk], .job_seen_beacon, .slider_container, .jobsearch-SerpJobCard').first();
    const href = element.is('a') ? element.attr('href') : root.find('a[href*="jk="]').first().attr('href');
    let id = canonicalIndeedId(root.attr('data-jk') || element.attr('data-jk'));
    if (!id && href) {try {id = indeedJobId(new URL(href, 'https://www.indeed.com').toString());} catch { /* skip */ }}
    if (!id) return;
    const title = clean(root.find('h2.jobTitle span[title], a.jcs-JobTitle span, h2.jobTitle, a.jcs-JobTitle').first().attr('title') || root.find('h2.jobTitle, a.jcs-JobTitle').first().text());
    const company = clean(root.find('[data-testid="company-name"], .companyName').first().text());
    if (!title || !company) return;
    const location = clean(root.find('[data-testid="text-location"], .companyLocation').first().text()) || null;
    rows.push({source:'Indeed', id, title, company, location, url:`https://www.indeed.com/viewjob?jk=${id}`,
      postedAt:null, datePrecision:null,
      postedText:clean(root.find('[data-testid="myJobsStateDate"], .date').first().text()) || null,
      workplace:normalizeWorkplace(location), employmentType:null, seniorityLevel:null,
      description:clean(root.find('.job-snippet, [data-testid="jobsnippet_footer"] + div').first().text()) || null,
      applicantCount:null, underTenApplicants:null, verified:null, fetchedAt:new Date().toISOString(), detailsFetched:false});
  });
  // Prefer structured records over DOM fallbacks for the same posting.
  const unique = new Map();
  for (const row of rows) if(!conflictingIds.has(row.id))unique.set(row.id,mergeKnown(row,unique.get(row.id)||{}));
  const result=[...unique.values()];result.schemaRejected=schemaRejected;
  return result;
}
export function parseIndeedDetail(html, fallback = {}) {
  assertPublicHtml(html);
  const $ = load(html || '');
  const entries=structuredJobs(html);
  const ld = entries.find(entry=>{try{return indeedJobId(entry.url)===fallback.id;}catch{return false;}}) || (entries.length===1?entries[0]:null);
  if(ld?.url && fallback.id) {let id;try{id=indeedJobId(ld.url);}catch{}if(id && id!==fallback.id)throw new Error('Indeed: detail metadata belongs to a different posting.');}
  const canonical=$('link[rel="canonical"]').attr('href');
  if(canonical && fallback.id) {let id;try{id=indeedJobId(canonical);}catch{}if(id && id!==fallback.id)throw new Error('Indeed: canonical detail belongs to a different posting.');}
  if (!ld && !$('h1.jobsearch-JobInfoHeader-title, #jobDescriptionText').length) throw new Error('Indeed: unrecognized job detail HTML.');
  fallback = mergeKnown(fallback, structuredFields(ld || {}));
  const title = clean($('h1.jobsearch-JobInfoHeader-title, h1').first().text()) || ld?.title || fallback.title || null;
  const company = clean($('[data-testid="inlineHeader-companyName"], .jobsearch-InlineCompanyRating').first().text()) || ld?.hiringOrganization?.name || fallback.company || null;
  const description = clean($('#jobDescriptionText').text()) || fallback.description || null;
  const date = parseDate(ld?.datePosted);
  return normalizeJob({...fallback, source:'Indeed', title, company, description, postedAt:date.postedAt || fallback.postedAt || null,
    datePrecision:date.datePrecision || fallback.datePrecision || null, detailsFetched:true, fetchedAt:new Date().toISOString()});
}

export const indeedProvider = {
  accessPolicy:'robots-conditional',prepareHttp:(http,context)=>policyHttp(http,'https://www.indeed.com',context),
  name:'Indeed', searchUrl:makeIndeedUrl, parseCards:parseIndeedCards,
  parseDetail:parseIndeedDetail, jobId:indeedJobId,
  detailUrl:id => `https://www.indeed.com/viewjob?jk=${encodeURIComponent(id)}`,
  facets:indeedFacets, pageSize:10,
  nextPage(html) {
    const $=load(html),href=$('a[rel="next"], a[data-testid="pagination-page-next"]').first().attr('href');
    if(!href) return null;
    const url=new URL(href,'https://www.indeed.com');
    if(url.origin!=='https://www.indeed.com'||url.pathname!=='/jobs'||url.username||url.password) throw new Error('Indeed: unsupported public pagination URL.');
    return url.toString();
  },
  emptyPattern:/no (?:matching )?jobs found|did not match any jobs|data-testid=["\']no-results["\']/i
};
export function findIndeedJobs(options, http,context) {return searchProvider(indeedProvider, options, http,undefined,context);}
