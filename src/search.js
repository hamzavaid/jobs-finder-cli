import {rankJobs} from './relevance.js';
import {providers} from './providers.js';
import {searchProvider} from './provider-search.js';
import {CollectionManager} from './collection.js';
import {createApiClient} from './api-http.js';
import {identifyCrossSourceDuplicates} from './dedup.js';
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
  const candidateOptions = {...options,limit:Math.min(1000,Math.max(100,options.limit * 4))};
  const selected = options.websites ?? Object.keys(providers);
  const outcomes = await Promise.all(selected.map(async site => {
    try {
      context.signal?.throwIfAborted();
      context.report?.(site,'searching');
      const provider = providers[site];
      if (!provider) throw new Error(`Unknown provider: ${site}`);
      const outcome = provider.kind === 'ats' ? await collection.find(provider,candidateOptions) : await searchProvider(provider,candidateOptions,http);
      context.signal?.throwIfAborted();
      context.report?.(site,`${outcome.jobs.length} matching jobs collected`);
      return {site,outcome};
    } catch (error) {context.report?.(site,error.name === 'AbortError' ? 'canceled' : 'provider failed');return {site,error};}
  }));
  await collection?.cache.flush();
  if (collection?.cache.prune && !context.signal?.aborted) {
    try {await collection.cache.prune();} catch (error) {context.report?.('Cache',`pruning deferred: ${error.message}`);}
  }
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
  const merged = providerJobs.flatMap(provider => provider.jobs);
  const duplicateHints = identifyCrossSourceDuplicates(merged);
  stats.possibleCrossSourceDuplicates = duplicateHints.possible;
  stats.exactCacheHits = outcomes.filter(item => item.outcome?.stats.exactCacheHit).length;
  stats.duplicatesRemoved = outcomes.reduce((sum,item) => sum + (item.outcome?.stats.duplicatesRemoved || 0),0);
  return {jobs:rankJobs(duplicateHints.jobs,options,{now:context.now?.() ?? Date.now()}).slice(0,options.limit),stats};
}
