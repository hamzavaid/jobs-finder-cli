import {PipelineMetrics} from './pipeline-metrics.js';
import {rankJobs} from './relevance.js';
import {providers} from './providers.js';
import {searchProvider} from './provider-search.js';
import {CollectionManager} from './collection.js';
import {createApiClient} from './api-http.js';
import {consolidateJobs} from './dedup.js';
export {fetchJob, findLinkedInJobs} from './linkedin.js';

/** Execute selected providers concurrently; preserve selection order when interleaving. */
export async function findJobs(options, http, context = {}) {
  const metrics = new PipelineMetrics();
  const providerJobs = [], allErrors = [];
  const stats = {pages:0, cardsSeen:0, rejected:0, detailRequests:0, unknownExcluded:0,
    facetReliant:[], errors:[], providers:{}};
  let successfulProviders = 0;
  let collection;
  if ((options.websites ?? Object.keys(providers)).some(site => ['ats','feed'].includes(providers[site]?.kind))) {
    collection = context.collection || new CollectionManager({...context,http:context.apiHttp || createApiClient({signal:context.signal,delayMs:options.delay})});
  }
  const initialTransport = {...collection?.http?.metrics};
  const candidateOptions = {...options,limit:Math.min(1000,Math.max(100,options.limit * 4))};
  const selected = options.websites ?? Object.keys(providers);
  const outcomes = await Promise.all(selected.map(async site => {
    try {
      context.signal?.throwIfAborted();
      context.report?.(site,'searching');
      const provider = providers[site];
      if (!provider) throw new Error(`Unknown provider: ${site}`);
      const outcome = ['ats','feed'].includes(provider.kind) ? await collection.find(provider,candidateOptions) : await searchProvider(provider,candidateOptions,http);
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
    stats.providers[site] = {...outcome.stats,pages:outcome.stats.pages,results:outcome.jobs.length,partial:!!outcome.stats.errors?.length,
      boardsKnown:outcome.stats.boardsKnown,boardsVisited:outcome.stats.boardsVisited,cacheHits:outcome.stats.cacheHits};
    for (const key of ['pages','cardsSeen','rejected','detailRequests','unknownExcluded']) stats[key] += outcome.stats[key];
    stats.facetReliant.push(...outcome.stats.facetReliant.map(filter => `${site}:${filter}`));
    providerJobs.push({site,jobs:outcome.jobs});
  }
  if (!successfulProviders) throw new AggregateError(allErrors, `All selected sites failed: ${stats.errors.join(' | ')}`);
  const merged = providerJobs.flatMap(provider => provider.jobs);
  const duplicateHints = consolidateJobs(merged);
  stats.possibleCrossSourceDuplicates = duplicateHints.possible;stats.identityConflicts = duplicateHints.conflicts;
  stats.exactCacheHits = outcomes.filter(item => item.outcome?.stats.exactCacheHit).length;
  stats.duplicatesRemoved = duplicateHints.confirmed + outcomes.reduce((sum,item) => sum + (item.outcome?.stats.duplicatesRemoved || 0),0);
  metrics.add('sourcesAttempted',selected.length);metrics.add('sourcesSuccessful',successfulProviders);
  for (const key of ['boardsKnown','boardsVisited','boardsSkipped','boardsRefreshed','boardsBlocked','cacheHits','completePostings','incompletePostings','schemaRejected','resolutionAttempts','resolutionSuccesses']) metrics.add(key,outcomes.reduce((sum,item)=>sum+(item.outcome?.stats[key]||0),0));
  if (collection?.http?.metrics) {metrics.add('httpRequests',collection.http.metrics.requests-(initialTransport.requests||0));metrics.add('httpBytes',collection.http.metrics.bytes-(initialTransport.bytes||0));}
  stats.metrics=metrics.snapshot();
  return {jobs:rankJobs(duplicateHints.jobs,options,{now:context.now?.() ?? Date.now()}).slice(0,options.limit),stats};
}
