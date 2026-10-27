import {providers} from './providers.js';
import {searchProvider} from './provider-search.js';
import {CollectionManager} from './collection.js';
import {createApiClient} from './api-http.js';
export {fetchJob, findLinkedInJobs} from './linkedin.js';

/** Execute selected providers concurrently; preserve selection order when interleaving. */
export async function findJobs(options, http, context = {}) {
  const providerJobs = [], allErrors = [];
  const stats = {pages:0, cardsSeen:0, rejected:0, detailRequests:0, unknownExcluded:0,
    facetReliant:[], errors:[], providers:{}};
  let successfulProviders = 0;
  let collection;
  if ((options.websites ?? Object.keys(providers)).some(site => providers[site]?.kind === 'ats')) {
    collection = context.collection || new CollectionManager({...context,http:context.apiHttp || createApiClient({signal:context.signal,delayMs:options.delay})});
  }
  const selected = options.websites ?? Object.keys(providers);
  const outcomes = await Promise.all(selected.map(async site => {
    try {
      context.signal?.throwIfAborted();
      context.report?.(site,'searching');
      const provider = providers[site];
      if (!provider) throw new Error(`Unknown provider: ${site}`);
      const outcome = provider.kind === 'ats' ? await collection.find(provider,options) : await searchProvider(provider,options,http);
      context.signal?.throwIfAborted();
      context.report?.(site,`${outcome.jobs.length} matching jobs collected`);
      return {site,outcome};
    } catch (error) {context.report?.(site,error.name === 'AbortError' ? 'canceled' : 'provider failed');return {site,error};}
  }));
  await collection?.cache.flush();
  context.signal?.throwIfAborted();
  for (const {site,outcome,error} of outcomes) {
    if (error) {
      allErrors.push(error);stats.errors.push(`${site}: ${error.message}`);stats.providers[site] = {error:error.message};continue;
    }
    successfulProviders++;
    stats.errors.push(...(outcome.stats.errors || []));
    stats.providers[site] = {pages:outcome.stats.pages,results:outcome.jobs.length,partial:!!outcome.stats.errors?.length,
      boardsKnown:outcome.stats.boardsKnown,boardsVisited:outcome.stats.boardsVisited,cacheHits:outcome.stats.cacheHits};
    for (const key of ['pages','cardsSeen','rejected','detailRequests','unknownExcluded']) stats[key] += outcome.stats[key];
    stats.facetReliant.push(...outcome.stats.facetReliant.map(filter => `${site}:${filter}`));
    providerJobs.push({site,jobs:outcome.jobs});
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
  await collection?.cache.flush();
  return {jobs:merged, stats};
}
