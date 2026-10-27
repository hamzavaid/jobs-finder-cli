import {linkedinProvider} from './linkedin.js';
import {indeedProvider} from './indeed.js';
import {glassdoorProvider} from './glassdoor.js';
import {normalizeWebsites} from './filters.js';
import {normalizeJob} from './schema.js';
export const providers = Object.freeze({LinkedIn:linkedinProvider, Indeed:indeedProvider, Glassdoor:glassdoorProvider});
export function postingProvider(input, website) {
  let detected;
  if (/^[a-z]+:\/\//i.test(input)) {
    const url = new URL(input), host = url.hostname.toLowerCase();
    detected = host === 'linkedin.com' || host.endsWith('.linkedin.com') ? 'LinkedIn'
      : host === 'indeed.com' || host.endsWith('.indeed.com') ? 'Indeed'
      : ['glassdoor.com','www.glassdoor.com'].includes(host) ? 'Glassdoor' : null;
    if (!detected || url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Expected an HTTPS posting URL on LinkedIn, Indeed or Glassdoor.');
  }
  const sites = website ? normalizeWebsites(website) : [detected || 'LinkedIn'];
  if (sites.length !== 1) throw new Error('job requires exactly one --website.');
  if (detected && sites[0] !== detected) throw new Error('--website conflicts with the posting URL.');
  const provider = providers[sites[0]];
  provider.jobId(input);
  return provider;
}
export async function fetchProviderJob(input, website, http) {
  const provider = postingProvider(input,website), id = provider.jobId(input);
  if (provider.prepareHttp) http = await provider.prepareHttp(http);
  const url = /^https:\/\//i.test(input) ? input : provider.name === 'LinkedIn'
    ? `https://www.linkedin.com/jobs/view/${id}/` : provider.detailUrl(id);
  const requestUrl = provider.detailUrl(id,{url});
  return normalizeJob(provider.parseDetail(await http.get(requestUrl),{id,url,source:provider.name}));
}
