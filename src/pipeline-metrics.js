import {performance} from 'node:perf_hooks';
export class PipelineMetrics {
 constructor(){this.started=performance.now();this.stages=new Map();this.counts={};}
 add(name,value=1){if(Number.isFinite(value))this.counts[name]=(this.counts[name]||0)+value;}
 async stage(name,work){const start=performance.now();try{return await work();}finally{this.stages.set(name,(this.stages.get(name)||0)+performance.now()-start);}}
 snapshot(){return {...this.counts,elapsedMs:Math.round((performance.now()-this.started)*100)/100,stagesMs:Object.fromEntries(this.stages)};}
}
export function pipelineSummary(stats){const m=stats.metrics||{};return `Pipeline: ${m.sourcesSuccessful||0}/${m.sourcesAttempted||0} sources; ${m.boardsVisited||0} boards visited, ${m.boardsSkipped||0} skipped; ${m.completePostings||0} complete, ${m.incompletePostings||0} incomplete candidates; ${stats.duplicatesRemoved||0} confirmed duplicates; ${m.elapsedMs||0} ms${m.httpRequests==null?'':`; ${m.httpRequests} API/index requests, ${m.httpBytes||0} bytes`}.`;}

export function cacheDiagnostics(stats,jobsReturned) {
 const lines=[];
 for(const [site,provider] of Object.entries(stats.providers || {})) {
  if(provider.error || !Object.hasOwn(provider,'exactCacheHit'))continue;
  lines.push(provider.exactCacheHit ? `Cache: exact-search hit (${site})` : `Cache: exact-search miss (${site}): ${provider.exactCacheMissReason || 'provider has no exact-search cache'}`);
  const coverage=provider.coverage || provider;
  lines.push(`Source coverage (${site}): ${provider.complete ? 'complete' : 'partial'}; ${coverage.staleBoards || 0} boards ${provider.exactCacheHit ? 'previously served' : 'served'} stale; ${provider.boardsRefreshed || 0} refreshed this run.`);
 }
 const m=stats.metrics || {},t=stats.timings || {};
 lines.push(`Cache reuse: ${m.inventoryCacheHits || 0} inventories; ${m.postingSnapshotHits || 0} posting snapshots; ${m.detailCacheHits || 0} complete descriptions; ${m.detailCooldownHits || 0} detail cooldowns.`);
 lines.push(`Enrichment: bulk ${m.bulkAttempts || 0} attempted / ${m.bulkSuccesses || 0} succeeded / ${m.bulkFailures || 0} failed; ${m.detailRequests || 0} individual attempts.`);
 if(m.httpRequests!=null)lines.push(`Network requests: ${m.httpRequests} (API/index transport); ${m.htmlRequests || 0} public HTML requests.`);
 lines.push(`Jobs returned: ${jobsReturned}; ${m.acceptedAfterFiltering || 0} passed local filtering this run.`);
 lines.push(`Stage time (ms): discovery ${Math.round(t.discoveryMs || 0)}, collection ${Math.round(t.collectionMs || 0)}, enrichment ${Math.round(t.enrichmentMs || 0)}, filtering ${Math.round(t.filteringMs || 0)}, cache reads ${Math.round(t.cacheReadMs || 0)}, cache writes ${Math.round(t.cacheWriteMs || 0)}.`);
 return lines;
}
