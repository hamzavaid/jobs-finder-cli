import {load} from 'cheerio';

export const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const plainText = value => typeof value === 'string' ? clean(load(value).text()) || null : null;
export function normalizeJob(job) {
  return {source:null, id:null, title:null, company:null, location:null, url:null,
    sourceUrl:null, postedAt:null, datePrecision:null, postedText:null, workplace:null,
    employmentType:null, seniorityLevel:null, salary:null, description:null,
    applicantCount:null, underTenApplicants:null, verified:null, detailsFetched:false,
    fetchedAt:new Date().toISOString(), ...job};
}
export function structuredJobs(html) {
  const $ = load(html || ''), jobs = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {value.forEach(visit); return;}
    if ([value['@type']].flat().includes('JobPosting')) jobs.push(value);
    if (value['@graph']) visit(value['@graph']);
    if (Array.isArray(value.itemListElement)) value.itemListElement.forEach(item => visit(item.item || item));
    if (value.mainEntity) visit(value.mainEntity);
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {visit(JSON.parse($(el).html()));} catch { /* Invalid metadata is not executable. */ }
  });
  return jobs;
}
export function structuredFields(ld = {}) {
  const location = [ld.jobLocation].flat().filter(Boolean).map(item => {
    const a = item.address;
    return a ? [a.addressLocality,a.addressRegion,a.addressCountry?.name || a.addressCountry].filter(x => typeof x === 'string').join(', ') : item.name;
  }).filter(Boolean).join('; ') || null;
  const validDate = typeof ld.datePosted === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(ld.datePosted) && Number.isFinite(Date.parse(ld.datePosted));
  return {title:clean(ld.title) || null, company:clean(ld.hiringOrganization?.name) || null,
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
