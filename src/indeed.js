/** Indeed public HTML reader. Does not impersonate browsers, login, bypass challenges, or use hidden APIs. */
import {load} from 'cheerio';
import {normalizeCompany, evaluateJob, normalizeWorkplace} from './filters.js';

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
  const out = [];
  if (o.dateSeconds && indeedDateBucket(o.dateSeconds)) out.push('date');
  if (o.employment && typeMap[o.employment]) out.push('employment');
  if (o.experience && expMap[o.experience]) out.push('experience');
  if (o.remote === true || ['remote','hybrid'].includes(o.workplace)) out.push('workplace', 'remote');
  return out;
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
  const hit = marker.exec(html);
  if (!hit) return null;
  let start = hit.index + hit[0].length;
  while (/\s/.test(html[start] || '') && start < html.length) start++;
  if (html[start] !== '{' && html[start] !== '[') return null;
  const stack = [];
  let string = false, escape = false;
  for (let i = start; i < html.length; i++) {
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
function candidateArrays(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 7) return [];
  if (Array.isArray(obj)) {
    if (obj.some(x => x && typeof x === 'object' && (x.jk || x.jobkey || x.jobKey) && (x.title || x.jobTitle))) return [obj];
    return obj.flatMap(x => candidateArrays(x, depth + 1));
  }
  return Object.entries(obj).filter(([key]) => !['query','filters','facets','translations','tracking'].includes(key))
    .flatMap(([,value]) => candidateArrays(value, depth + 1));
}
function parseDate(value) {
  if (value == null || value === '') return {postedAt:null, datePrecision:null};
  if (typeof value === 'number') {
    const t = value < 1e11 ? value * 1000 : value;
    if (t > 0 && t < Date.now() + 86400000) return {postedAt:new Date(t).toISOString(), datePrecision:'instant'};
  }
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d(T.+)?$/.test(value)) {
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
    if (!/(^|\.)indeed\.com$/i.test(u.hostname)) throw new Error('Not an Indeed URL');
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
  const posted = parseDate(job.datePublished ?? job.pubDate ?? job.dateOnIndeed ?? job.datePosted);
  const rawLocation = pick(job, ['formattedLocation','location','jobLocation','jobLocationCity','formattedLocationShort','locationName']);
  const remote = job.isRemote === true ? 'remote' : null;
  const workplace = remote || normalizeWorkplace(pick(job, ['remoteLocation','workplaceType','locationType','remoteType']) || rawLocation);
  const taxonomy = Array.isArray(job.taxonomyAttributes) ? job.taxonomyAttributes : [];
  const jobTypes = taxonomy.filter(t => /job[- ]types/i.test(t.label || ''))
    .flatMap(t => (t.attributes || []).map(a => a.label)).filter(Boolean);
  const employmentType = pick(job, ['employmentType','jobType']) || jobTypes[0] || null;
  return {
    source:'Indeed', id, title, company, location:rawLocation,
    url:`https://www.indeed.com/viewjob?jk=${encodeURIComponent(id)}`,
    sourceUrl:null, postedAt:posted.postedAt, datePrecision:posted.datePrecision,
    postedText:pick(job, ['formattedRelativeTime','formattedDate','date','age','relativeTime']) || null,
    companyLogo:pick(job, ['companyLogoUrl']) || null,
    workplace, employmentType, seniorityLevel:pick(job,['experienceLevel']) || null,
    jobFunction:null, industries:null, description:pick(job,['snippet','description','jobDescription']) || null,
    applicantsText:null, applicantCount:null, underTenApplicants:null, verified:null,
    fetchedAt:new Date().toISOString(), detailsFetched:false
  };
}
export function parseIndeedCards(html) {
  const obj = extractJsonAssignment(html, MOSAIC) || extractJsonAssignment(html, INITIAL);
  const rows = candidateArrays(obj).flat().map(parseIndeedObject).filter(Boolean);
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
  for (const row of rows) if (!unique.has(row.id)) unique.set(row.id, row);
  return [...unique.values()];
}
export function parseIndeedDetail(html, fallback = {}) {
  const $ = load(html || '');
  let ld = null;
  $('script[type="application/ld+json"]').each((_, e) => {
    if (ld) return;
    try {
      const obj = JSON.parse($(e).html());
      const items = Array.isArray(obj) ? obj : [obj];
      ld = items.find(x => String(x?.['@type']).includes('JobPosting')) || null;
    } catch { /* no parseable structured metadata */ }
  });
  const title = clean($('h1.jobsearch-JobInfoHeader-title, h1').first().text()) || ld?.title || fallback.title || null;
  const company = clean($('[data-testid="inlineHeader-companyName"], .jobsearch-InlineCompanyRating').first().text()) || ld?.hiringOrganization?.name || fallback.company || null;
  const description = clean($('#jobDescriptionText').text()) || clean(ld?.description?.replace?.(/<[^>]+>/g,' ')) || fallback.description || null;
  const date = parseDate(ld?.datePosted);
  return {...fallback, source:'Indeed', title, company, description, postedAt:date.postedAt || fallback.postedAt || null,
    datePrecision:date.datePrecision || fallback.datePrecision || null, detailsFetched:true, fetchedAt:new Date().toISOString()};
}

/** Fetches public search-card pages; strictly excludes unknown unsupported facets. */
export async function findIndeedJobs(options, http) {
  const results = new Map(), seen = new Set();
  const stats = {pages:0, cardsSeen:0, detailRequests:0, rejected:0, unknownExcluded:0, facetReliant:new Set()};
  const evaluation = {...options, provider:'Indeed', indeedSupportedFacets:indeedFacets(options)};
  const needsDetails = options.details || options.strict;
  for (let page = 0; page < options.pages && results.size < options.limit; page++) {
    const html = await http.get(makeIndeedUrl(options, page * 10));
    const cards = parseIndeedCards(html);
    stats.pages++;
    if (!cards.length) break;
    let newlySeen = 0;
    for (const card of cards) {
      if (seen.has(card.id)) continue;
      newlySeen++;
      seen.add(card.id);
      stats.cardsSeen++;
      if (options.company && normalizeCompany(card.company) !== normalizeCompany(options.company)) {stats.rejected++; continue;}
      let job = card;
      // If facets aren't publicly observable, fetching the posting may expose employment/workplace/date.
      if (needsDetails) {
        const detail = await http.get(card.url);
        job = parseIndeedDetail(detail, card);
        stats.detailRequests++;
      }
      const decision = evaluateJob(job, evaluation);
      if (!decision.match) {
        stats.rejected++;
        if (decision.unknowns.length || decision.facetReliant.length) stats.unknownExcluded++;
        continue;
      }
      job.filterEvidence = decision.facetReliant.length ? 'indeed-facet-unconfirmed' : 'observed-or-unfiltered';
      job.unconfirmedFilters = decision.facetReliant;
      for (const f of decision.facetReliant) stats.facetReliant.add(`Indeed:${f}`);
      results.set(job.id, job);
      if (results.size >= options.limit) break;
    }
    if (newlySeen === 0) break;
  }
  return {jobs:[...results.values()], stats:{...stats, facetReliant:[...stats.facetReliant]}};
}
