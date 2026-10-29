/** Deterministic lexical retrieval; aliases are equivalents, never fuzzy substrings. */
export const RELEVANCE_VERSION = 2;
export const DEFAULT_WEIGHTS = Object.freeze({phrase:40,title:25,description:20,aliases:10,freshness:5});
export const DEFAULT_ALIASES = Object.freeze({rn:'registered nurse',cpa:'certified public accountant',js:'javascript',nodejs:'node.js',dotnet:'.net'});
const morphology = new Map(Object.entries({engineering:'engineer',engineers:'engineer',developer:'develop',developers:'develop',development:'develop',developing:'develop',analytics:'analyst',analysts:'analyst',accountants:'accountant',nurses:'nurse',chefs:'chef',teachers:'teacher',interns:'intern',internship:'intern'}));
export const normalizeText = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export function tokenize(value) {
  return normalizeText(value).match(/\.net\b|[\p{L}\p{N}]+(?:\+\+|#|(?:\.[\p{L}\p{N}]+)+)?/gu) || [];
}
const root = token => morphology.get(token) || token;
function expanded(value,aliases) {return tokenize(value).flatMap(token => tokenize(Object.hasOwn(aliases,token) ? aliases[token] : token)).map(root);}
function contains(haystack,needle) {return needle.length > 0 && haystack.some((_,i) => needle.every((t,j) => haystack[i+j] === t));}
export function relevance(job,query,{now = Date.now(),weights = DEFAULT_WEIGHTS,aliases = DEFAULT_ALIASES} = {}) {
  const terms = [...new Set(expanded(query,aliases))], title = expanded(job.title,aliases), description = expanded(job.description,aliases);
  const all = new Set([...title,...description]), matchedTerms = terms.filter(t => all.has(t)), missingTerms = terms.filter(t => !all.has(t));
  const quoted = [...String(query || '').matchAll(/"([^"]+)"/g)].map(m => expanded(m[1],aliases));
  const phrasesMatch = quoted.every(phrase => contains(title,phrase) || contains(description,phrase));
  const complete = job.descriptionCompleteness === 'complete' || (!!job.description && !job.descriptionCompleteness);
  const uncertain = (missingTerms.length > 0 || !phrasesMatch) && !complete;
  const coverage = tokens => terms.length ? terms.filter(t => tokens.includes(t)).length / terms.length : 1;
  const titleRaw = tokenize(job.title), queryRaw = tokenize(query);
  const signals = {phrase:contains(titleRaw,queryRaw) ? 1 : 0,title:coverage(title)};
  if ([...titleRaw,...queryRaw].some(token => Object.hasOwn(aliases,token))) signals.aliases = coverage(title);
  if (job.description) signals.description = coverage(description);
  const date = job.datePrecision === 'instant' ? Date.parse(job.postedAt) : NaN;
  if (Number.isFinite(date) && date <= now) signals.freshness = Math.max(0,1-(now-date)/(30*86400000));
  const denominator = Object.keys(signals).reduce((sum,key) => sum + (weights[key] || 0),0);
  const score = terms.length && denominator ? 100 * Object.entries(signals).reduce((sum,[key,value]) => sum + value*(weights[key] || 0),0)/denominator : 0;
  return {match:(!terms.length || !missingTerms.length) && phrasesMatch,score,matchedTerms,missingTerms,uncertainty:uncertain ? ['description'] : [],needsEnrichment:uncertain};
}
export function rankJobs(jobs,options,{now = Date.now()} = {}) {
  const scored = jobs.map(job => ({job,score:relevance(job,options.search,{now}).score}));
  const trustedDate = job => {const date=job.postedAt && ['day','instant'].includes(job.datePrecision) ? Date.parse(job.postedAt) : NaN;return Number.isFinite(date) && date <= now ? date : -Infinity;};
  const dateCompare = (a,b) => trustedDate(a) === trustedDate(b) ? 0 : trustedDate(a) > trustedDate(b) ? -1 : 1;
  const stable = job => [normalizeText(job.company),normalizeText(job.title),job.source,job.region,job.boardId,job.id].join(':');
  scored.sort((a,b) => (options.sort === 'recent' ? dateCompare(a.job,b.job) || b.score-a.score : b.score-a.score || dateCompare(a.job,b.job)) || stable(a.job).localeCompare(stable(b.job),'en'));
  return scored.map(({job,score}) => ({...job,relevanceScore:score}));
}
