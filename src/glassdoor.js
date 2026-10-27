/** Glassdoor public HTML only. No GraphQL, cookies, login or browser impersonation. */
import {load} from 'cheerio';
import robotsParser from 'robots-parser';
import {normalizeWorkplace} from './filters.js';
import {assertPublicHtml, AccessError} from './http.js';
import {clean, normalizeJob, structuredJobs, structuredFields, mergeKnown} from './schema.js';
import {searchProvider} from './provider-search.js';

const origin = 'https://www.glassdoor.com';
function publicUrl(value) {
  const url = new URL(value, origin);
  if (url.protocol !== 'https:' || !['www.glassdoor.com','glassdoor.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Expected a Glassdoor HTTPS posting URL.');
  return url;
}
export function glassdoorJobId(value) {
  if (/^\d{5,20}$/.test(String(value))) return String(value);
  try {
    const url = publicUrl(value);
    if (!url.pathname.startsWith('/job-listing/')) throw new Error('Not a posting');
    const id = url.searchParams.get('jl') || url.searchParams.get('jobListingId');
    if (/^\d{5,20}$/.test(id || '')) return id;
  } catch { /* Descriptive validation below. */ }
  throw new Error('Expected a Glassdoor numeric listing ID or HTTPS job-listing URL containing jl.');
}
export function makeGlassdoorUrl(options) {
  const keyword = options.search || options.company;
  // This public SEO route was visible during research. Avoid undocumented filter IDs.
  if (!keyword) return `${origin}/Job/index.htm`;
  const slug = encodeURIComponent(keyword.toLowerCase().replace(/\s+/g, '-'));
  return `${origin}/Job/${slug}-jobs-SRCH_KO0,${keyword.length}.htm`;
}
export function glassdoorDetailUrl(id, job = {}) {
  const url = job.sourceUrl || job.url;
  if (url) {glassdoorJobId(url); return publicUrl(url).toString();}
  return `${origin}/job-listing/JV.htm?jl=${glassdoorJobId(id)}`;
}
function fromStructured(ld) {
  const rawUrl = ld.url || (typeof ld.mainEntityOfPage === 'string' ? ld.mainEntityOfPage : null);
  if (!rawUrl) return null;
  let id, url;
  try {id = glassdoorJobId(rawUrl); url = publicUrl(rawUrl).toString();} catch {return null;}
  const fields = structuredFields(ld);
  if (!fields.title || !fields.company) return null;
  return normalizeJob({...fields, source:'Glassdoor', id, url, sourceUrl:url});
}
export function parseGlassdoorCards(html) {
  assertPublicHtml(html);
  const $ = load(html || ''), rows = structuredJobs(html).map(fromStructured).filter(Boolean);
  $('[data-test="jobListing"], [data-test="job-card"], li[data-jobid], li[class*="JobsList_jobListItem"], .react-job-listing').each((_, el) => {
    const root = $(el);
    const link = root.find('a[data-test="job-title"], a.JobCard_jobTitle, a[href*="/job-listing/"]').first();
    let id, url;
    try {id = glassdoorJobId(link.attr('href')); url = publicUrl(link.attr('href')).toString();} catch {return;}
    const read = selector => clean(root.find(selector).first().text()) || null;
    const title = clean(link.text()), company = read('[data-test="employer-name"], [class*="EmployerProfile_compactEmployerName"], .jobEmpolyerName');
    if (!title || !company) return;
    const location = read('[data-test="emp-location"], [data-test="job-location"], [class*="JobCard_location"]');
    const workplace = read('[data-test="workplace-type"]');
    const time = root.find('time[datetime]').first().attr('datetime');
    const posted = structuredFields({datePosted:time});
    rows.push(normalizeJob({source:'Glassdoor',id,url,sourceUrl:url,title,company,location,
      postedAt:posted.postedAt,datePrecision:posted.datePrecision,
      postedText:read('[data-test="job-age"], [class*="JobCard_listingAge"]'),
      workplace:normalizeWorkplace(workplace || location),
      employmentType:read('[data-test="job-type"]'),seniorityLevel:read('[data-test="seniority-level"]'),
      salary:read('[data-test="detailSalary"], [data-test="salary-estimate"], [class*="JobCard_salaryEstimate"]'),
      description:read('[data-test="job-snippet"], [class*="JobCard_jobDescriptionSnippet"]')}));
  });
  const unique = new Map();
  for (const row of rows) unique.set(row.id, mergeKnown(row, unique.get(row.id) || {}));
  return [...unique.values()];
}
export function parseGlassdoorDetail(html, fallback = {}) {
  assertPublicHtml(html);
  const $ = load(html || '');
  const entries = structuredJobs(html);
  const ld = entries.find(entry => {
    try {return glassdoorJobId(entry.url) === fallback.id;} catch {return false;}
  }) || (entries.length === 1 ? entries[0] : null);
  const fields = structuredFields(ld || {});
  const read = selector => clean($(selector).first().text()) || null;
  const title = fields.title || read('[data-test="jobTitle"], [data-test="job-title"], h1');
  const description = fields.description || read('[data-test="jobDescriptionContent"], .jobDescriptionContent, [class*="JobDetails_jobDescription"]');
  if (!ld && (!title || !description)) throw new Error('Glassdoor: unrecognized job detail HTML; login or client rendering may be required.');
  return normalizeJob(mergeKnown(fallback, {...fields, title, description,
    company:fields.company || read('[data-test="employerName"], [data-test="employer-name"]'),
    location:fields.location || read('[data-test="location"], [data-test="job-location"]'),
    workplace:fields.workplace || normalizeWorkplace(read('[data-test="workplace-type"]')),
    salary:fields.salary || read('[data-test="detailSalary"], [data-test="salary-estimate"]'),
    employmentType:fields.employmentType || read('[data-test="job-type"]'),
    seniorityLevel:fields.seniorityLevel || read('[data-test="seniority-level"]'),
    source:'Glassdoor', detailsFetched:true, fetchedAt:new Date().toISOString()}));
}
export async function glassdoorHttp(http) {
  const robotsUrl = `${origin}/robots.txt`;
  const body = await http.get(robotsUrl);
  if (!/^\s*user-agent\s*:/im.test(body) || /<html/i.test(body)) throw new AccessError('Glassdoor: robots.txt could not be verified; stopped without requesting job pages.');
  const rules = robotsParser(robotsUrl, body);
  return {get:async value => {
    const url = publicUrl(value).toString();
    if (rules.isAllowed(url, 'jobs-cli') === false) throw new AccessError(`Glassdoor: robots.txt disallows ${new URL(url).pathname}; public pagination or detail access is restricted.`);
    return http.get(url);
  }};
}
function nextPage(html) {
  const $ = load(html);
  const href = $('a[rel="next"], a[data-test="pagination-next"]').first().attr('href');
  if (href) {
    const url = publicUrl(href);
    if (!url.pathname.startsWith('/Job/')) throw new Error('Glassdoor: unsupported public pagination URL.');
    return url.toString();
  }
  if (/show more jobs/i.test($('button').text())) throw new Error('Glassdoor: further pages require client-side loading; no permitted public next-page link was exposed.');
  return null;
}
export const glassdoorProvider = {
  name:'Glassdoor', searchUrl:makeGlassdoorUrl, parseCards:parseGlassdoorCards,
  parseDetail:parseGlassdoorDetail, jobId:glassdoorJobId, detailUrl:glassdoorDetailUrl,
  facets:() => [], prepareHttp:glassdoorHttp, nextPage,
  emptyPattern:/no (?:matching )?jobs found|no results found|data-test=["']no-results["']/i
};
export function findGlassdoorJobs(options, http) {return searchProvider(glassdoorProvider, options, http);}
