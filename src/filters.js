import {tokenize} from './relevance.js';
import {validSourceDate} from './schema.js';
export const FILTER_VERSION = 3;
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
export const WEBSITES = Object.freeze({linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', greenhouse:'Greenhouse',lever:'Lever',ashby:'Ashby',smartrecruiters:'SmartRecruiters',personio:'Personio',remotive:'Remotive',himalayas:'Himalayas',github:'GitHub'});
export function normalizeWebsites(values) {
  const tokens = (Array.isArray(values) ? values : values == null ? [] : [values]).flatMap(v => String(v).split(','));
  if (!tokens.length) return Object.values(WEBSITES).filter(site => site !== 'GitHub');
  const out = [];
  for (const token of tokens) {
    const key = token.trim().toLowerCase();
    const name = Object.hasOwn(WEBSITES, key) ? WEBSITES[key] : null;
    if (!name) throw new Error(`Unknown --website '${token}'. Choose ${Object.values(WEBSITES).join(', ')}.`);
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
  if (search && !tokenize(search).length) throw new Error('--search must contain a searchable word or technical term.');
  const company = String(input.company ?? '').trim();
  const location = String(input.location ?? '').trim();
  if([search,company,location].some(value=>value.length>2000)) throw new Error('Search, company and location must each contain at most 2000 characters.');
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
  // Retrieval hints improve the candidate pool; they never verify a constraint.
  const keywords=linkedInKeywords(options);
  if (keywords) url.searchParams.set('keywords',keywords);
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

export function linkedInKeywords(options) {
  let query=options.search || '';
  const contains=(text,phrase)=>{const haystack=tokenize(text),needle=tokenize(phrase);return needle.length && haystack.some((_,index)=>needle.every((word,offset)=>haystack[index+offset]===word));};
  if(options.company && !contains(query,options.company))query=[query,options.company].filter(Boolean).join(' ');
  const code=EXPERIENCE[options.experience];
  if(code==='2' && !/\b(?:entry[- ]level|junior|new grad(?:uate)?)\b/i.test(query))query=[query,'entry-level'].filter(Boolean).join(' ');
  if(code==='1' && !/\bintern(?:ship)?\b/i.test(query))query=[query,'internship'].filter(Boolean).join(' ');
  return query;
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
  const inferredFilters=[];
  if (o.company && normalizeCompany(job.company) !== normalizeCompany(o.company)) failures.push('company');
  if(o.company && job.companyEvidence && job.companyEvidence!=='observed')unknowns.push('company');
  if (o.location) {
    const locations=[job.location,...(job.secondaryLocations || [])].filter(Boolean),wanted=tokenize(o.location);
    if (!locations.length) unknowns.push('location');
    else if (!locations.some(value=>{const words=tokenize(value);return words.some((_,index)=>wanted.every((word,offset)=>words[index+offset]===word));})) failures.push('location');
  }
  const provider = o.provider || job.source || 'LinkedIn';
  const supported = o.supportedFacets ?? (provider === 'LinkedIn' ? ['date','workplace','remote','experience','employment','under','verified'] : o.indeedSupportedFacets || []);
  const hasFacet = key => supported.includes(key);
  if (o.dateSeconds) {
    if (job.postedAt && job.datePrecision === 'instant') {
      const t = Date.parse(job.postedAt);
      if (!validSourceDate(job.postedAt) || job.postedAt.length===10) unknowns.push('date');
      else if (t > now || now - t > o.dateSeconds * 1000) failures.push('date');
    } else if (job.postedAt && job.datePrecision === 'day') {
      const day = Date.parse(job.postedAt);
      // Calendar dates have no source timezone: allow the full UTC-14..UTC+14 envelope.
      const earliest = day - 14 * 3600000, latest = day + 38 * 3600000;
      const cutoff = now - o.dateSeconds * 1000;
      if (!validSourceDate(job.postedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(job.postedAt)) unknowns.push('date');
      else if (latest < cutoff || earliest > now) failures.push('date');
      else if (earliest < cutoff || latest > now) (hasFacet('date') ? facetReliant : unknowns).push('date');
    } else {
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
  const count=Number.isInteger(job.applicantCount) && job.applicantCount>=0?job.applicantCount:null;
  const under=count===null?job.underTenApplicants:count<10;
  if(o.under!=null && count!==null && typeof job.underTenApplicants==='boolean' && job.underTenApplicants!==under)failures.push('under');
  validateFacet('under', o.under, under, o.under === true && hasFacet('under'));
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
    const expected=EXPERIENCE[o.experience],observed=knownExperience(job.seniorityLevel),title=titleExperience(job.title);
    // Conflicts are rejected, never resolved by overwriting employer metadata.
    if(title.nonEntry && ['1','2'].includes(expected) || observed && title.code && observed!==title.code) failures.push('experience');
    else if(observed) {if(observed!==expected)failures.push('experience');}
    else if(job.seniorityLevel && !/^(?:not applicable|n\/a|unknown|unspecified)$/i.test(String(job.seniorityLevel).trim()))markUnknown('experience');
    else if(title.code && !o.strict) {if(title.code!==expected)failures.push('experience');else inferredFilters.push('experience');}
    else markUnknown('experience');
  }
  if (o.employment) {
    if (!job.employmentType) markUnknown('employment');
    else {
      const types = [job.employmentType].flat().flatMap(v => String(v).split(/[,;/|]|\s+and\s+/i)).map(knownEmployment).filter(Boolean);
      if (!types.length) markUnknown('employment');
      else if (!types.includes(EMPLOYMENT[o.employment])) failures.push('employment');
    }
  }
  return {match:!failures.length&&!unknowns.length&&!facetReliant.length,failures,unknowns,facetReliant,inferredFilters};
}
export function normalizeWorkplace(input) {
  const s = String(input || '').toLowerCase().replaceAll('_','-');
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\bremote\b/.test(s) && /\b(?:on[- ]?site|in[- ]?person)\b/.test(s)) return null;
  if (/\b(on[- ]?site|in[- ]?person)\b/.test(s)) return 'onsite';
  if (/\b(?:not|no) remote\b/.test(s)) return null;
  if (/\bremote\b/.test(s)) return 'remote';
  return null;
}
export function knownExperience(input) {
  const s = String(input || '').toLowerCase().replaceAll('_','-');
  if(/^(?:associate |senior )?director(?: level)?$/.test(s.trim()))return '5';
  const codes=[[/\bexecutive\b/,'6'],[/\bdirector\b/,'5'],[/\b(?:intern|internship)\b/,'1'],[/\b(?:entry|junior)\b/,'2'],[/\b(?:mid|senior|staff|principal)\b/,'4'],[/\bassociate\b/,'3']].filter(([pattern])=>pattern.test(s)).map(([,code])=>code);
  return new Set(codes).size===1?codes[0]:null;
}
export function titleExperience(value) {
  // These phrases describe a population or a reporting relationship, not rank.
  const title=String(value||'').normalize('NFKC')
    .replace(/\bsenior[- ]+(?:living|care|citizens?|communit(?:y|ies)|services)\b/gi,'')
    .replace(/\b(?:assistant|support|advisor|adviser)\s+(?:to|for)\s+(?:the\s+)?(?:senior\s+|executive\s+)?(?:director|executive|principal)\b/gi,'');
  const nonEntry=/\b(?:senior|sr\.?|staff|principal|director|executive)\b/i.test(title);
  const signals=[[/\b(?:intern|internship)\b/i,'1'],[/\b(?:junior|jr\.?|entry[- ]level)\b/i,'2'],[/\b(?:senior|sr\.?)\b/i,'4'],[/\bdirector\b/i,'5']].filter(([pattern])=>pattern.test(title)).map(([,code])=>code);
  return {code:new Set(signals).size===1?signals[0]:null,nonEntry};
}
export function knownEmployment(input) {
  const s = String(input || '').toLowerCase().replaceAll('_','-');
  if (/\b(?:intern|internship)\b/.test(s)) return 'I';
  if (/part[- ]?time/.test(s)) return 'P';
  if (/full[- ]?time/.test(s)) return 'F';
  if (/contract/.test(s)) return 'C';
  if (/temporary/.test(s)) return 'T';
  if (/\bvolunteer\b/.test(s)) return 'V';
  if (/^other$/.test(s.trim())) return 'O';
  return null;
}

export function validateOutputOptions(input) {
  if (input.format && !['table','json','jsonl','csv'].includes(input.format)) throw new Error('--format must be table, json, csv or jsonl.');
  if (input.delay !== undefined) integerBetween(input.delay,750,30000,'--delay');
  if (input.limit !== undefined) integerBetween(input.limit,1,Number.MAX_SAFE_INTEGER,'--limit');
  return input;
}
