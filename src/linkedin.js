import {makeSearchUrl} from './filters.js';
import {parseSearchCards, parseJobDetail, canonicalJobId} from './parser.js';
import {searchProvider} from './provider-search.js';
import {normalizeJob} from './schema.js';
export const linkedinProvider = {
  name:'LinkedIn', searchUrl:makeSearchUrl, parseCards:parseSearchCards,
  parseDetail:parseJobDetail, jobId:canonicalJobId,
  detailUrl:id => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`,
  facets:() => ['date','workplace','remote','experience','employment','under','verified'],
  emptyPattern:/no-results|no (?:matching )?jobs found|^\s*<ul>\s*<\/ul>\s*$/i
};
export async function fetchJob(input, http) {
  const id = canonicalJobId(input), url = `https://www.linkedin.com/jobs/view/${id}/`;
  return normalizeJob(parseJobDetail(await http.get(linkedinProvider.detailUrl(id)), {id,url}));
}
export function findLinkedInJobs(options, http, onProgress) {return searchProvider(linkedinProvider, options, http, onProgress);}
