import {load} from 'cheerio';
import {normalizeWorkplace} from './filters.js';
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const first = ($el, selectors) => {
  for (const selector of selectors) {
    const value = clean($el.find(selector).first().text());
    if (value) return value;
  }
  return null;
};
export function canonicalJobId(value) {
  const str = String(value || '');
  const id = /(?:jobPosting:|\/jobs\/view\/(?:[^/?]*?-)?|\/jobPosting\/)(\d{5,})/.exec(str)?.[1];
  if (id) return id;
  if (/^\d{5,}$/.test(str)) return str;
  throw new Error('Expected a LinkedIn job ID or a LinkedIn jobs/view URL.');
}
function postedData($el) {
  const time = $el.find('time[datetime]').first();
  const raw = time.attr('datetime') || null;
  let postedAt = null;
  let datePrecision = null;
  if (raw && !Number.isNaN(Date.parse(raw))) {
    postedAt = /^\d{4}-\d\d-\d\d$/.test(raw) ? raw : new Date(raw).toISOString();
    datePrecision = /^\d{4}-\d\d-\d\d$/.test(raw) ? 'day' : 'instant';
  }
  const postedText = clean(time.text()) || null;
  return {postedAt, datePrecision, postedText};
}
export function parseSearchCards(html) {
  const $ = load(html || '');
  const jobs = [];
  const roots = $('li').filter((_, el) => {
    const node = $(el);
    return node.find('.base-search-card, .job-search-card, a.base-card__full-link').length > 0
      || String(node.attr('data-entity-urn') || '').includes('jobPosting:');
  });
  roots.each((_, el) => {
    const root = $(el);
    const node = root.find('.base-search-card, .job-search-card').first().length
      ? root.find('.base-search-card, .job-search-card').first() : root;
    const link = node.find('a.base-card__full-link, a.base-search-card__full-link, a[href*="/jobs/view/"]').first();
    const urn = root.attr('data-entity-urn') || node.attr('data-entity-urn') || '';
    let id;
    try { id = canonicalJobId(urn || link.attr('href') || node.attr('data-entity-urn')); }
    catch { return; }
    const title = first(node, ['h3.base-search-card__title', 'h3', '.base-card__title']);
    const company = first(node, ['h4.base-search-card__subtitle a', 'h4.base-search-card__subtitle', 'h4', '.base-search-card__subtitle']);
    const location = first(node, ['.job-search-card__location', '.base-search-card__metadata', '.job-search-card__subtitle']);
    const {postedAt, datePrecision, postedText} = postedData(node);
    const context = clean(node.find('.job-search-card__listdate, .job-search-card__listdate--new').text());
    const sourceUrl = link.attr('href') || null;
    if (!title || !company) return;
    const badges = clean(node.find('[aria-label], .job-search-card__benefits, .job-search-card__verified').map((_, e) => $(e).attr('aria-label') || $(e).text()).get().join(' '));
    const explicitVerified = /\b(verified job|job is verified|has verifications)\b/i.test(badges) ? true : null;
    jobs.push({
      id, source: 'LinkedIn', title, company, location, url:`https://www.linkedin.com/jobs/view/${id}/`,
      sourceUrl, postedAt, datePrecision, postedText: postedText || context || null,
      companyLogo: node.find('.artdeco-entity-image, img').first().attr('data-delayed-url') || node.find('img').first().attr('src') || null,
      workplace: null, seniorityLevel: null, employmentType: null,
      jobFunction: null, industries: null, description: null,
      applicantsText: null, applicantCount: null, underTenApplicants: null,
      verified: explicitVerified, fetchedAt: new Date().toISOString(), detailsFetched: false
    });
  });
  return [...new Map(jobs.map(x => [x.id, x])).values()];
}
export function parseJobDetail(html, fallback = {}) {
  const $ = load(html || '');
  const id = fallback.id;
  const result = {
    id: null, source: 'LinkedIn', title: null, company: null, location: null, postedAt: null,
    datePrecision: null, postedText: null, workplace: null,
    employmentType: null, seniorityLevel: null, jobFunction: null,
    industries: null, description: null, applicantsText: null,
    applicantCount: null, underTenApplicants: null, verified: null,
    detailsFetched: false, ...fallback
  };
  const root = $('body');
  result.title = first(root, ['h1.top-card-layout__title', 'h1.topcard__title', 'h1']) || fallback.title || null;
  result.company = first(root, ['.topcard__org-name-link', '.top-card-layout__second-subline a', '.topcard__flavor a']) || fallback.company || null;
  result.location = first(root, ['.topcard__flavor--bullet', '.top-card-layout__second-subline span']) || fallback.location || null;
  result.description = first(root, ['.show-more-less-html__markup', '.description__text']) || fallback.description || null;
  const posted = postedData(root);
  if (posted.postedAt) {
    result.postedAt = posted.postedAt;
    result.datePrecision = posted.datePrecision;
  }
  if (posted.postedText) result.postedText = posted.postedText;
  const criteria = {};
  $('.description__job-criteria-item, .job-criteria__item').each((_, el) => {
    const e = $(el);
    const header = clean(e.find('h3, .description__job-criteria-subheader').first().text()).toLowerCase();
    const value = first(e, ['.description__job-criteria-text', '.job-criteria__text', 'span']) || null;
    if (header && value) criteria[header] = value;
  });
  result.seniorityLevel = criteria['seniority level'] || fallback.seniorityLevel || null;
  result.employmentType = criteria['employment type'] || fallback.employmentType || null;
  result.jobFunction = criteria['job function'] || fallback.jobFunction || null;
  result.industries = criteria['industries'] || fallback.industries || null;
  // Only use applicant text from the applicant-count component, not a description's prose.
  const applicantsText = first(root, ['.num-applicants__caption', '.topcard__flavor--metadata + .topcard__flavor', '.jobs-unified-top-card__applicant-count']);
  if (applicantsText) {
    result.applicantsText = applicantsText;
    const match = /^([\d,]+)\s+applicants?\b/i.exec(applicantsText);
    if (match && !/over\s+[\d,]+\s+applicants?/i.test(applicantsText)) {
      result.applicantCount = Number(match[1].replaceAll(',', ''));
      result.underTenApplicants = result.applicantCount < 10;
    } else if (/over\s+(\d[\d,]*)\s+applicants?/i.test(applicantsText)) {
      result.underTenApplicants = false;
      result.applicantCount = null; // lower bound, not an exact number
    }
  }
  const aria = $('[aria-label*="Verified"], [aria-label*="verified"], .verified-badge, .job-verification-badge')
    .map((_, el) => `${$(el).attr('aria-label') || ''} ${$(el).text()}`).get().join(' ');
  if (/\bverified\b/i.test(aria) && !/not verified/i.test(aria)) result.verified = true;
  if (/\bnot verified\b/i.test(aria)) result.verified = false;
  // Avoid matching 'remote' mentioned only in the job description.
  const surroundings = [
    first(root, ['.topcard__flavor--metadata', '.top-card-layout__third-subline']),
    first(root, ['.job-details-jobs-unified-top-card__workplace-type'])
  ].filter(Boolean).join(' ');
  result.workplace = normalizeWorkplace(surroundings) || fallback.workplace || null;
  result.detailsFetched = true;
  result.fetchedAt = new Date().toISOString();
  if (id) result.id = id;
  return result;
}
