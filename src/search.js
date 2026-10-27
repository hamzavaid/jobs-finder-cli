import {providers} from './providers.js';
import {searchProvider} from './provider-search.js';
export {fetchJob, findLinkedInJobs} from './linkedin.js';

/** Run selected providers sequentially through a shared rate-limited HTTP client. */
export async function findJobs(options, http) {
  const providerJobs = [], allErrors = [];
  const stats = {pages:0, cardsSeen:0, rejected:0, detailRequests:0, unknownExcluded:0,
    facetReliant:[], errors:[], providers:{}};
  let successfulProviders = 0;
  for (const site of options.websites ?? ['LinkedIn','Indeed']) {
    try {
      const provider = providers[site];
      if (!provider) throw new Error(`Unknown provider: ${site}`);
      const outcome = await searchProvider(provider, options, http);
      stats.errors.push(...(outcome.stats.errors || []));
      successfulProviders++;
      stats.providers[site] = {pages:outcome.stats.pages, results:outcome.jobs.length};
      for (const key of ['pages', 'cardsSeen', 'rejected', 'detailRequests', 'unknownExcluded']) stats[key] += outcome.stats[key];
      stats.facetReliant.push(...outcome.stats.facetReliant.map(f => `${site}:${f}`));
      providerJobs.push({site, jobs:outcome.jobs});
    } catch (error) {
      const message = `${site}: ${error.message}`;
      allErrors.push(error);
      stats.errors.push(message);
      stats.providers[site] = {error: error.message};
    }
  }
  if (!successfulProviders) throw new AggregateError(allErrors, `All selected sites failed: ${stats.errors.join(' | ')}`);
  // Interleave sites so a full LinkedIn page cannot prevent Indeed from appearing.
  const merged = [];
  for (let i = 0; merged.length < options.limit; i++) {
    let added = 0;
    for (const provider of providerJobs) {
      if (provider.jobs[i]) {merged.push(provider.jobs[i]); added++;}
      if (merged.length >= options.limit) break;
    }
    if (!added) break;
  }
  return {jobs:merged, stats};
}
