/** Validation and mapping for job-search criteria (industry-agnostic). */
export const EXPERIENCE = Object.freeze({
  internship: '1', intern: '1', entry: '2', 'entry-level': '2', junior: '2',
  associate: '3', 'mid-senior': '4', senior: '4', mid: '4',
  director: '5', executive: '6'
});
export const EMPLOYMENT = Object.freeze({
  'full-time': 'F', fulltime: 'F', 'part-time': 'P', parttime: 'P',
  contract: 'C', temporary: 'T', internship: 'I', intern: 'I',
  volunteer: 'V', other: 'O'
});
export const WEBSITES = Object.freeze({linkedin: 'LinkedIn', indeed: 'Indeed'});
export function normalizeWebsites(values) {
  const tokens = (Array.isArray(values) ? values : values == null ? [] : [values]).flatMap(v => String(v).split(','));
  if (!tokens.length || tokens.every(v => !v.trim())) return ['LinkedIn', 'Indeed'];
  const out = [];
  for (const token of tokens) {
    const key = token.trim().toLowerCase();
    const name = Object.hasOwn(WEBSITES, key) ? WEBSITES[key] : null;
    if (!name) throw new Error(`Unknown --website '${token}'. Choose LinkedIn and/or Indeed.`);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
export const WORKPLACE = Object.freeze({ onsite: '1', 'on-site': '1', remote: '2', hybrid: '3' });

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase().trim();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`Expected true or false, received: ${value}`);
}
export function parseDuration(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  const match = /^(\d+)(h|d|w)$/.exec(v);
  if (!match) throw new Error('Invalid --date. Use 1h, 1d, 3d, 7d, or 30d (Nh/Nd/Nw).');
  const seconds = Number(match[1]) * ({h:3600,d:86400,w:604800}[match[2]]);
  if (!Number.isSafeInteger(seconds) || seconds < 3600 || seconds > 31536000) {
    throw new Error('--date must be between 1 hour and 365 days.');
  }
  return seconds;
}
export function normalizeChoice(value, choices, flag) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
  if (!Object.hasOwn(choices, v)) throw new Error(`Invalid ${flag}: '${value}'. Choose: ${Object.keys(choices).join(', ')}`);
  return v;
}
export function integerBetween(value, min, max, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}
export function normalizeOptions(input) {
  const experience = normalizeChoice(input.experience, EXPERIENCE, '--experience');
  const employment = normalizeChoice(input.employment, EMPLOYMENT, '--employment');
  const workplace = normalizeChoice(input.workplace, WORKPLACE, '--workplace');
  const remote = input.remote === undefined ? null : parseBoolean(input.remote);
  const under = input.under === undefined ? null : parseBoolean(input.under);
  const verified = input.verified === undefined ? null : parseBoolean(input.verified);
  const limit = integerBetween(input.limit ?? 25, 1, 200, '--limit');
  const pages = integerBetween(input.pages ?? 5, 1, 20, '--pages');
  const delay = integerBetween(input.delay ?? 1200, 750, 30000, '--delay');
  if (workplace && remote !== null) throw new Error('Use --workplace or --remote, not both.');
  const search = String(input.search ?? '').trim();
  const company = String(input.company ?? '').trim();
  const location = String(input.location ?? '').trim();
  if (!search && !company && !location) {
    throw new Error('Provide at least one of --search, --company or --location. No default occupation is assumed.');
  }
  const sort = input.sort ?? 'recent';
  if (!['recent', 'relevant'].includes(sort)) throw new Error('--sort must be recent or relevant.');
  const format = input.format ?? 'table';
  if (!['table', 'json', 'csv', 'jsonl'].includes(format)) throw new Error('--format must be table, json, csv or jsonl.');
  return {
    search, company, location, dateSeconds: parseDuration(input.date), experience,
    employment, workplace, remote, under, verified, limit, pages, delay,
    sort, format, output: input.output || null, details: !!input.details,
    save: !!input.save, strict: !!input.strict, websites: normalizeWebsites(input.website)
  };
}

export function makeSearchUrl(options, start = 0) {
  const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
  // Company names aren't numeric company IDs. Use as keywords only if no search text
  // was supplied; apply a normalized exact-company comparison after retrieval.
  if (options.search || options.company) url.searchParams.set('keywords', options.search || options.company);
  if (options.location) url.searchParams.set('location', options.location);
  if (options.dateSeconds) url.searchParams.set('f_TPR', `r${options.dateSeconds}`);
  if (options.experience) url.searchParams.set('f_E', EXPERIENCE[options.experience]);
  if (options.employment) url.searchParams.set('f_JT', EMPLOYMENT[options.employment]);
  if (options.workplace) url.searchParams.set('f_WT', WORKPLACE[options.workplace]);
  else if (options.remote === true) url.searchParams.set('f_WT', '2');
  else if (options.remote === false) url.searchParams.set('f_WT', '1,3');
  if (options.under === true) url.searchParams.set('f_EA', 'true');
  if (options.verified === true) url.searchParams.set('f_VJ', 'true');
  url.searchParams.set('sortBy', options.sort === 'recent' ? 'DD' : 'R');
  url.searchParams.set('start', String(start));
  return url.toString();
}

export function normalizeCompany(s = '') {
  return String(s).toLowerCase().replace(/\b(incorporated|inc\.?|llc|ltd\.?|limited|corp\.?|corporation)\b\.?/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
/** Returns 'yes', 'no' or 'unknown': unknown is NOT equivalent to false. */
export function evaluateJob(job, o, now = Date.now()) {
  const failures = [];
  const unknowns = [];
  const facetReliant = [];
  if (o.company && normalizeCompany(job.company) !== normalizeCompany(o.company)) failures.push('company');
  const provider = o.provider || job.source || 'LinkedIn';
  const supported = o.supportedFacets ?? (provider === 'LinkedIn' ? ['date','workplace','remote','experience','employment','under','verified'] : o.indeedSupportedFacets || []);
  const hasFacet = key => supported.includes(key);
  if (o.dateSeconds) {
    if (job.postedAt && job.datePrecision === 'instant') {
      const t = Date.parse(job.postedAt);
      if (!Number.isFinite(t)) unknowns.push('date');
      else if (t > now || now - t > o.dateSeconds * 1000) failures.push('date');
    } else {
      // A day-only date cannot establish a precise 24-hour window.
      (hasFacet('date') ? facetReliant : unknowns).push('date');
    }
  }
  const validateFacet = (name, expected, actual, trueHasFacet) => {
    if (expected == null) return;
    if (actual === null || actual === undefined) {
      if (trueHasFacet) facetReliant.push(name);
      else unknowns.push(name);
    } else if (actual !== expected) failures.push(name);
  };
  validateFacet('under', o.under, job.underTenApplicants, o.under === true && hasFacet('under'));
  validateFacet('verified', o.verified, job.verified, o.verified === true && hasFacet('verified'));
  const markUnknown = (key) => (hasFacet(key) ? facetReliant : unknowns).push(key);
  const wantedWorkplace = o.workplace || (o.remote === true ? 'remote' : null);
  if (wantedWorkplace) {
    if (!job.workplace) markUnknown('workplace');
    else if (!normalizeWorkplace(job.workplace)) markUnknown('workplace');
    else if (normalizeWorkplace(job.workplace) !== normalizeWorkplace(wantedWorkplace)) failures.push('workplace');
  } else if (o.remote === false) {
    if (!job.workplace) markUnknown('remote');
    else if (!normalizeWorkplace(job.workplace)) markUnknown('remote');
    else if (normalizeWorkplace(job.workplace) === 'remote') failures.push('remote');
  }
  if (o.experience) {
    if (!job.seniorityLevel) markUnknown('experience');
    else if (!knownExperience(job.seniorityLevel)) markUnknown('experience');
    else if (EXPERIENCE[o.experience] !== knownExperience(job.seniorityLevel)) failures.push('experience');
  }
  if (o.employment) {
    if (!job.employmentType) markUnknown('employment');
    else if (!knownEmployment(job.employmentType)) markUnknown('employment');
    else if (EMPLOYMENT[o.employment] !== knownEmployment(job.employmentType)) failures.push('employment');
  }
  if (failures.length) return {match: false, failures, unknowns, facetReliant};
  if (unknowns.length || (o.strict && facetReliant.length)) return {match: false, failures, unknowns, facetReliant};
  return {match: true, failures, unknowns, facetReliant};
}
export function normalizeWorkplace(input) {
  const s = String(input || '').toLowerCase();
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\b(on[- ]?site|in[- ]?person)\b/.test(s)) return 'onsite';
  if (/\bremote\b/.test(s)) return 'remote';
  return null;
}
export function knownExperience(input) {
  const s = String(input || '').toLowerCase();
  if (/intern/.test(s)) return '1';
  if (/entry|junior/.test(s)) return '2';
  if (/associate/.test(s)) return '3';
  if (/mid|senior/.test(s)) return '4';
  if (/director/.test(s)) return '5';
  if (/executive/.test(s)) return '6';
  return null;
}
export function knownEmployment(input) {
  const s = String(input || '').toLowerCase();
  if (/intern/.test(s)) return 'I';
  if (/part[- ]?time/.test(s)) return 'P';
  if (/full[- ]?time/.test(s)) return 'F';
  if (/contract/.test(s)) return 'C';
  if (/temporary/.test(s)) return 'T';
  if (/volunteer/.test(s)) return 'V';
  return null;
}

export function validateOutputOptions(input) {
  if (input.format && !['table','json','jsonl','csv'].includes(input.format)) throw new Error('--format must be table, json, csv or jsonl.');
  if (input.delay !== undefined) integerBetween(input.delay,750,30000,'--delay');
  if (input.limit !== undefined) integerBetween(input.limit,1,200,'--limit');
  return input;
}
