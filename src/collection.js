import {scheduleBoards,observeBoard} from './board-scheduler.js';
import {normalizeText} from './relevance.js';
import {PARSER_VERSION,validSourceDate} from './schema.js';
import {CacheManager,CACHE_TTL,stableKey} from './cache.js';
import {DiscoveryManager,inventoryFingerprint,mergeInventory} from './discovery.js';
import {createApiClient} from './api-http.js';
import {enrichOnce,preserveEnrichment,enrichmentFailure,retryDue,enrichmentPriority} from './enrichment.js';
import {FilterEngine} from './filter-engine.js';
import {FILTER_VERSION} from './filters.js';
import {boardKey,emptyStats} from './ats/shared.js';
import {mapConcurrent} from './concurrency.js';

export function postingRevision(jobs) {
 return stableKey(jobs.map(({fetchedAt,firstSeenAt,lastSeenAt,lastObservedAt,cacheFetchedAt,cacheStatus,enrichment,...job}) => job).sort((a,b)=>a.id.localeCompare(b.id)));
}
export function searchCacheKey(options,provider,budgets={maxBoards:64,maxEnrichments:40,maxBulkEnrichments:8}) {
  const {search,company,location,dateSeconds,remote,workplace,experience,employment,under,verified,limit,pages,sort,details,strict} = options;
  return stableKey({retrievalVersion:8,filterVersion:FILTER_VERSION,parserVersion:PARSER_VERSION,budgets,provider,search:normalizeText(search),company:normalizeText(company),location:normalizeText(location),dateSeconds,remote,workplace,experience,employment,under,verified,limit,pages,sort,details,strict});
}
export class CollectionManager {
  constructor({cache,http,signal,report = () => {},now = Date.now,maxBoards = 64,maxEnrichments = 40,maxBulkEnrichments = 8,discoveryOptions = {}} = {}) {
    Object.assign(this,{signal,report,now,maxBoards,maxEnrichments,maxBulkEnrichments,discoveryOptions});
    this.cache = cache || new CacheManager({signal,onWarning:message => report('Cache',message)});
    this.http = http || createApiClient({signal});
  }
  async lookupExact(provider,options) {
    this.signal?.throwIfAborted();
    const inventory = provider.kind === 'feed' ? feedInventory(provider) : (await this.cache.read('inventory',provider.name))?.data;
    const key=searchCacheKey(options,provider.name,{maxBoards:this.maxBoards,maxEnrichments:this.maxEnrichments,maxBulkEnrichments:this.maxBulkEnrichments});
    const miss=reason=>({key,inventory,reason});
    if(!inventory)return miss('inventory missing');
    const exact=await this.cache.read('search',key);
    if(!exact)return miss('search cache missing or corrupt');
    if(!this.cache.fresh(exact))return miss('search TTL expired');
    if(exact.data.parserVersion!==PARSER_VERSION || exact.data.cachePolicyVersion!==2)return miss('incompatible parser or cache policy');
    if(options.dateSeconds && (!Number.isFinite(exact.data.dateValidUntil) || exact.data.dateValidUntil<=this.now()))return miss('rolling date boundary reached');
    if(exact.data.inventoryFingerprint!==inventoryFingerprint(inventory))return miss('inventory membership changed');
    const validation=await mapConcurrent(exact.data.refs,2,async ref=>{
      this.signal?.throwIfAborted();
      if(!Number.isFinite(Date.parse(ref.validUntil)) || Date.parse(ref.validUntil)<=this.now())return 'snapshot freshness or stale retention expired';
      const record=this.cache.postingManifest ? await this.cache.postingManifest(ref.key) : await this.cache.read('postings',ref.key);
      if(!record)return 'snapshot missing, corrupt or being replaced';
      if(record.data.parserVersion!==PARSER_VERSION)return 'snapshot parser changed';
      if(record.data.revision!==ref.revision)return 'posting revision changed';
      const retention=Date.parse(record.data.lastSuccessfulFetchAt || record.updatedAt)+CACHE_TTL.stale;
      if(!Number.isFinite(retention)||retention<=this.now())return 'stale retention expired';
      if(!ref.stale && !this.cache.fresh(record))return 'snapshot freshness expired';
      return null;
    },{signal:this.signal});
    const failed=validation.find(Boolean);if(failed)return miss(failed);
    if(exact.data.jobs.some(job=>job.expiresAt && Date.parse(job.expiresAt)<=this.now()))return miss('posting expired');
    const coverage=exact.data.coverage;
    const stats={...exact.data.stats,coverage,pages:0,cardsSeen:0,detailRequests:0,rejected:0,unknownExcluded:0,
      boardsVisited:0,boardsRefreshed:0,postingSnapshotHits:0,completePostings:0,incompletePostings:0,
      bulkAttempts:0,bulkSuccesses:0,bulkFailures:0,bulkCooldownHits:0,detailCacheHits:0,detailCooldownHits:0,exploratoryDetails:0,failedBoards:0,acceptedAfterFiltering:0,
      cacheHits:exact.data.refs.length,inventoryCacheHit:true,exactCacheHit:true,exactCacheMisses:0,exactCacheMissReason:null,boardsScheduled:0,refreshedBoardKeys:[],skippedBoardKeys:[],
      timings:{discoveryMs:0,collectionMs:0,enrichmentMs:0,filteringMs:0}};
    this.report(provider.name,'exact-search cache hit');
    return {key,inventory,outcome:{jobs:exact.data.jobs,stats}};
  }
  async find(provider,options) {
    const started=performance.now(),before={...this.cache.metrics};
    const first=await this.lookupExact(provider,options);
    const work=async()=>{const probe=await this.lookupExact(provider,options);return probe.outcome || this.collect(provider,options,probe);};
    let outcome;
    if(first.outcome)outcome=first.outcome;
    else outcome=this.cache.coordinateSearch ? await this.cache.coordinateSearch(first.key,work) : await work();
    const after=this.cache.metrics || {};
    outcome.stats.timings={...outcome.stats.timings,cacheReadMs:(after.readMs||0)-(before.readMs||0),cacheWriteMs:(after.writeMs||0)-(before.writeMs||0),elapsedMs:performance.now()-started};
    return outcome;
  }
  async collect(provider,options,probe) {
    const stats = {...emptyStats(),boardsKnown:0,boardsVisited:0,cacheHits:0,staleBoards:0,complete:false,duplicatesRemoved:0,partialBoards:0,failedBoards:0,
      exactCacheHit:false,exactCacheMisses:1,exactCacheMissReason:probe.reason,inventoryCacheHit:!!probe.inventory,postingSnapshotHits:0,acceptedAfterFiltering:0,bulkAttempts:0,bulkSuccesses:0,bulkFailures:0,detailCacheHits:0,detailCooldownHits:0,
      timings:{discoveryMs:0,collectionMs:0,enrichmentMs:0,filteringMs:0}};
    const discoveryStarted=performance.now();
    const discovery=provider.kind==='feed' ? {inventory:feedInventory(provider),errors:[],complete:true} : await new DiscoveryManager({cache:this.cache,http:this.http,signal:this.signal,report:this.report,now:this.now,...this.discoveryOptions}).ensure(provider);
    stats.timings.discoveryMs=performance.now()-discoveryStarted;
    const inventory=discovery.inventory,sourceTtl=provider.cacheTtl || CACHE_TTL.postings,key=probe.key;
    stats.errors.push(...discovery.errors);
    const boards = inventory.boards.filter(board => board.status === 'valid' || board.status === 'pending');
    if (!boards.length) throw new Error(`${provider.name}: no validated boards available${discovery.errors.length ? '; ' + discovery.errors.join(' | ') : '; discovery or validation is incomplete'}.`);
    stats.boardsKnown = boards.length;
    const engine = new FilterEngine(options,{now:this.now}), results = new Map(),refs = [],changes = [];
    const dateEvaluationAt=this.now();let dateValidUntil=dateEvaluationAt+CACHE_TTL.search;
    const evaluate=engine.evaluate.bind(engine);engine.evaluate=job=>{const started=performance.now();try{return evaluate(job);}finally{stats.timings.filteringMs+=performance.now()-started;}};
    let snapshots = boards.map(board => ({board,key:`${provider.name}:${boardKey(board)}${provider.searchScoped ? ":query:"+stableKey(normalizeText(options.search)) : ""}`}));
    // Read large posting shards only inside the two-worker loop, never all at once.
    snapshots = scheduleBoards(snapshots,options,{now:this.now(),budget:this.maxBoards});
    stats.boardsScheduled = Date.parse(inventory.providerRetryAt)>this.now()?0:Math.min(this.maxBoards,boards.filter(board=>!(Date.parse(board.retryAt)>this.now())).length);
    stats.refreshedBoardKeys=[];stats.skippedBoardKeys=[];
    let refreshes = 0,metadataRequests=0,providerBlocked = Date.parse(inventory.providerRetryAt) > this.now();
    this.report(provider.name,`fetching jobs: 0 / ${boards.length} boards`);
    const collectionStarted=performance.now();
    await mapConcurrent(snapshots,2,async ({board,key:boardCacheKey}) => {
      const collect = async (cacheOnly = false) => {
      let cached = await this.cache.read('postings',boardCacheKey);
      if(cached?.data.parserVersion !== PARSER_VERSION)cached=null;
      this.signal?.throwIfAborted();
      let record = cached,dirty = false;
      // Employer evidence is independent of the freshness of a lightweight posting list.
      if(options.company && provider.fetchCompany && !board.company && !cacheOnly && !providerBlocked && !(Date.parse(board.companyRetryAt)>this.now()) && metadataRequests<this.maxBoards) {
        metadataRequests++;
        try {board.company=await provider.fetchCompany(board,this.http);board.companyObservedAt=new Date(this.now()).toISOString();board.companyRetryAt=null;}
        catch(error) {
          if(error.name==='AbortError')throw error;
          board.companyRetryAt=error.retryAt || new Date(this.now()+15*60000).toISOString();
          stats.errors.push(`${provider.name}: ${board.id}: employer metadata unavailable: ${error.message}`);
          if([401,403,429].includes(error.status)){providerBlocked=true;inventory.providerRetryAt=board.companyRetryAt;}
        }
        changes.push({...board});
      }
      const contentNeeded = provider.name === 'Greenhouse' && options.details;
      const fresh = this.cache.fresh(cached) && cached.data.parserVersion === PARSER_VERSION && (!contentNeeded || cached.data.content) && (cached.data.complete || (cached.data.pages || 0) >= options.pages);
      if (fresh) {stats.cacheHits++;stats.postingSnapshotHits++;}
      else if (cacheOnly || providerBlocked || refreshes >= this.maxBoards || (board.retryAt && Date.parse(board.retryAt) > this.now())) {
        if (!cached || !this.cache.usableStale(cached)) {stats.skippedBoardKeys.push(boardKey(board));return;}
        stats.staleBoards++;
      } else {
        refreshes++;stats.refreshedBoardKeys.push(boardKey(board));
        try {
          const outcome = await provider.fetchBoard(board,this.http,{pages:options.pages,content:contentNeeded,cache:this.cache,signal:this.signal,search:options.search});
          const boardRetryAt = outcome.errorStatus ? outcome.retryAt || new Date(this.now() + 15 * 60000).toISOString() : null;
          if ([401,403,429].includes(outcome.errorStatus)) {providerBlocked = true;inventory.providerRetryAt = boardRetryAt;}
          stats.schemaRejected = (stats.schemaRejected || 0) + (outcome.rejected || 0);stats.pages += outcome.pages;stats.resolutionAttempts = (stats.resolutionAttempts || 0) + (outcome.resolutionAttempts || 0);stats.resolutionSuccesses = (stats.resolutionSuccesses || 0) + (outcome.resolutionSuccesses || 0);
          const fetchedAt = new Date(this.now()).toISOString();
          const previousById = new Map((cached?.data.jobs || []).map(job => [job.id,job]));
          const updated = {parserVersion:PARSER_VERSION,enrichment:cached?.data.enrichment || {},provider:provider.name,board,jobs:outcome.jobs.map(job => ({...preserveEnrichment(previousById.get(job.id),job),lastObservedAt:fetchedAt})),lastSuccessfulFetchAt:outcome.complete ? fetchedAt : cached?.data.lastSuccessfulFetchAt || cached?.updatedAt || fetchedAt,complete:outcome.complete,pages:outcome.pages,content:contentNeeded,
            revision:postingRevision(outcome.jobs)};
          // A truncated fetch never replaces a complete board inventory.
          if (!outcome.complete && cached) {
            const jobs = new Map(cached.data.jobs.filter(job => this.now() - Date.parse(job.lastObservedAt || cached.data.lastSuccessfulFetchAt || cached.updatedAt) <= CACHE_TTL.stale).map(job => [job.id,job]));
            for (const job of updated.jobs) jobs.set(job.id,job);
            updated.jobs = [...jobs.values()];updated.revision = postingRevision(updated.jobs);
          }
          record = {data:updated,updatedAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now() + (provider.cacheTtl || CACHE_TTL.postings)).toISOString()};dirty = true;
          changes.push({...board,successfulCollections:(board.successfulCollections||0)+1,recentPostingCount:outcome.jobs.filter(job => job.postedAt && this.now()-Date.parse(job.postedAt)<7*86400000).length,status:'valid',lastJobFetchAt:new Date(this.now()).toISOString(),lastValidatedAt:new Date(this.now()).toISOString(),validationAttemptAt:new Date(this.now()).toISOString(),retryAt:boardRetryAt});
          if (!outcome.complete) stats.errors.push(`${provider.name}: ${board.id}: partial board (${outcome.reason || 'pagination incomplete'}).`);
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          stats.failedBoards++;
          const invalid = [404,410].includes(error.status);
          if ([401,403,429].includes(error.status)) {providerBlocked = true;inventory.providerRetryAt = error.retryAt || new Date(this.now() + 15 * 60000).toISOString();}
          changes.push({...board,status:invalid ? 'invalid' : board.status,lastError:error.message,validationAttemptAt:new Date(this.now()).toISOString(),retryAt:error.retryAt || new Date(this.now() + (invalid ? 7 * 86400000 : 15 * 60000)).toISOString()});
          stats.errors.push(`${provider.name}: ${board.id}: ${error.message}`);
          if (invalid || !cached || !this.cache.usableStale(cached)) return;
          stats.staleBoards++;
        }
      }
      if (!record) return;
      if(board.company) {
        record.data.jobs=record.data.jobs.map(job=>{
          if(job.companyEvidence!=='board-identifier')return job;
          dirty=true;
          return {...job,company:board.company,employer:board.company,companyEvidence:'observed',employerIdentity:{name:board.company,evidence:'board-metadata',observedAt:board.companyObservedAt},companyObservedAt:board.companyObservedAt};
        });
        if(dirty)record.data.board={...record.data.board,...board};
      }
      stats.boardsVisited++;
      if (!record.data.complete) stats.partialBoards++;
      const enrichment=record.data.enrichment ||= {details:{}};
      enrichment.details ||= {};
      // A shared bounded budget favors partial keyword overlap and requested metadata.
      // A few no-overlap candidates remain eligible; missing descriptions are uncertain.
      let planned=record.data.jobs.map(job=>{const decision=engine.evaluate(job);return {job,decision,priority:enrichmentPriority(job,decision,options)};});
      const unresolved=planned.filter(item=>item.priority>=0 && item.decision.needsEnrichment);
      const plausible=unresolved.filter(item=>item.decision.matchedTerms.length || item.decision.unknowns.length || options.details);
      if (provider.name==='Greenhouse' && plausible.length>3 && !cacheOnly && !providerBlocked && retryDue(enrichment.bulk,this.now()) && stats.bulkAttempts<this.maxBulkEnrichments) {
        const started=performance.now();stats.bulkAttempts++;
        try {
          const bulk=await provider.fetchBoard(board,this.http,{content:true,pages:options.pages});
          const byId=new Map(bulk.jobs.map(job=>[job.id,job]));
          record.data.jobs=record.data.jobs.map(job=>preserveEnrichment(job,byId.get(job.id)||job));
          record.data.content=bulk.complete;dirty=true;stats.bulkSuccesses++;
          enrichment.bulk={status:bulk.complete?'complete':'incomplete',attemptedAt:new Date(this.now()).toISOString(),retryAt:new Date(this.now()+CACHE_TTL.enrichmentStructural).toISOString()};
          if(!bulk.complete)stats.errors.push(`${provider.name}: incomplete bulk enrichment (${bulk.reason}).`);
        } catch(error) {
          if(error.name==='AbortError')throw error;
          dirty=true;stats.bulkFailures++;enrichment.bulk=enrichmentFailure(error,this.now());
          stats.errors.push(`${provider.name}: bulk enrichment failed: ${error.message}; retry after ${enrichment.bulk.retryAt}.`);
          if([401,403,429].includes(error.status)){providerBlocked=true;inventory.providerRetryAt=enrichment.bulk.retryAt;}
        } finally {stats.timings.enrichmentMs+=performance.now()-started;}
      } else if(enrichment.bulk?.status==='failed'&&!retryDue(enrichment.bulk,this.now())) {
        stats.bulkCooldownHits=(stats.bulkCooldownHits||0)+1;
        stats.errors.push(`${provider.name}: ${board.id}: bulk enrichment cooldown (${enrichment.bulk.failureKind}) until ${enrichment.bulk.retryAt}.`);
      }
      if(stats.bulkSuccesses)planned=record.data.jobs.map(job=>{const decision=engine.evaluate(job);return {job,decision,priority:enrichmentPriority(job,decision,options)};});
      planned.sort((a,b)=>b.priority-a.priority||String(a.job.id).localeCompare(String(b.job.id)));
      const decisions=new Map(planned.map(item=>[item.job.id,item.decision]));
      record.data.jobs=planned.map(item=>item.job);
      let boardMatches = 0;
      const enriched = [];
      for (let job of record.data.jobs) {
        if (stats.cardsSeen && stats.cardsSeen % 512 === 0) {await new Promise(resolve => setImmediate(resolve));this.signal?.throwIfAborted();}
        stats.cardsSeen++;
        if (job.expiresAt && Date.parse(job.expiresAt) <= this.now()) continue;
        if (job.lastObservedAt && this.now() - Date.parse(job.lastObservedAt) > CACHE_TTL.stale) continue;
        const initial = decisions.get(job.id);let decision=initial;
        const needsContent = initial.needsEnrichment || options.details && job.descriptionCompleteness !== 'complete';
        const needsMetadata = provider.name === 'Greenhouse' && (options.dateSeconds && !job.postedAt || options.strict && initial.unknowns.some(field => !['under','verified'].includes(field)));
        const attempt=enrichment.details[job.providerJobId || job.id];
        const priority=enrichmentPriority(job,initial,options);
        const needed=needsContent || needsMetadata;
        if(provider.enrichJob && job.descriptionCompleteness==='complete')stats.detailCacheHits++;
        if(provider.enrichJob && needed && priority>=0 && !cacheOnly && !providerBlocked) {
          if(!retryDue(attempt,this.now()))stats.detailCooldownHits++;
          else if(stats.detailRequests<this.maxEnrichments) {
            // Preserve a small exploration budget for zero-overlap metadata rather
            // than using all detail capacity on unrelated title-only records.
            const exploration=!initial.matchedTerms.length && !initial.unknowns.length && !options.details;
            if(!exploration || (stats.exploratoryDetails||0)<Math.max(1,Math.min(4,this.maxEnrichments))) {
              const started=performance.now();stats.detailRequests++;if(exploration)stats.exploratoryDetails=(stats.exploratoryDetails||0)+1;
              try {
                job=preserveEnrichment(job,await enrichOnce(provider,board,job,this.http));dirty=true;
                const remaining=decision=engine.evaluate(job);
                const complete=job.descriptionCompleteness==='complete' && !remaining.unknowns.some(field=>!['under','verified'].includes(field));
                enrichment.details[job.providerJobId || job.id]={status:complete?'complete':'incomplete',attemptedAt:new Date(this.now()).toISOString(),lastSuccessAt:new Date(this.now()).toISOString(),retryAt:complete?null:new Date(this.now()+CACHE_TTL.enrichmentStructural).toISOString()};
              } catch(error) {
                if(error.name==='AbortError')throw error;dirty=true;
                enrichment.details[job.providerJobId || job.id]=enrichmentFailure(error,this.now());
                stats.errors.push(`${provider.name}: incomplete enrichment ${job.providerJobId}: ${error.message}`);job={...job,resolutionStatus:'incomplete'};
                if([401,403,429].includes(error.status)){providerBlocked=true;inventory.providerRetryAt=enrichment.details[job.providerJobId || job.id].retryAt;}
              } finally {stats.timings.enrichmentMs+=performance.now()-started;}
            }
          }
        }
        if(options.dateSeconds)dateValidUntil=Math.min(dateValidUntil,nextDateBoundary(job,options.dateSeconds,dateEvaluationAt));
        if (needsContent && decision.failures.includes('search') && job.descriptionCompleteness !== 'complete') stats.incompleteEvidence = (stats.incompleteEvidence || 0) + 1;
        stats[job.descriptionCompleteness === 'complete' ? 'completePostings' : 'incompletePostings'] = (stats[job.descriptionCompleteness === 'complete' ? 'completePostings' : 'incompletePostings'] || 0) + 1;
        enriched.push(job);
        if (!decision.match) {stats.rejected++;if (decision.unknowns.length) stats.unknownExcluded++;continue;}
        boardMatches++;stats.acceptedAfterFiltering++;
        if (results.has(job.id)) stats.duplicatesRemoved++;
        results.set(job.id,{...job,inferredFilters:decision.inferredFilters,filterEvidence:decision.inferredFilters?.length?'title-supplemented':job.filterEvidence,cacheStatus:this.cache.fresh(record) && (!job.lastObservedAt || this.now() - Date.parse(job.lastObservedAt) < sourceTtl) ? 'fresh' : 'stale',cacheFetchedAt:job.lastObservedAt || record.data.lastSuccessfulFetchAt || record.updatedAt});
        if (results.size > options.limit * 2) {
          const best = engine.sort([...results.values()]).slice(0,options.limit);results.clear();for (const row of best) results.set(row.id,row);
        }
      }
      if (dirty) {
        const activeIds=new Set(record.data.jobs.map(job=>job.providerJobId || job.id));
        enrichment.details=Object.fromEntries(Object.entries(enrichment.details).filter(([id])=>activeIds.has(id)));
        record.data.jobs = enriched;record.data.revision = postingRevision(enriched);
        const remaining = Math.max(0,Date.parse(record.expiresAt) - this.now());
        try {record = await this.cache.put('postings',boardCacheKey,record.data,{ttl:remaining});}
        catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: board cache write failed: ${error.message}`);}
      }
      if (provider.kind !== 'feed') {
        const changedIndex = changes.findIndex(item => boardKey(item) === boardKey(board));
        const observed = observeBoard(changedIndex >= 0 ? changes[changedIndex] : board,options,boardMatches,this.now());
        if (changedIndex >= 0) changes[changedIndex] = observed;else changes.push(observed);
      }
      const stale=!this.cache.fresh(record);
      const retention=Date.parse(record.data.lastSuccessfulFetchAt || record.updatedAt)+CACHE_TTL.stale;
      refs.push({key:boardCacheKey,revision:record.data.revision,stale,
        validUntil:new Date(stale ? retention : Math.min(retention,Date.parse(record.expiresAt))).toISOString()});
      this.report(provider.name,`fetching jobs: ${stats.boardsVisited} / ${boards.length} boards`);
      };
      if (this.cache.coordinateRefresh) await this.cache.coordinateRefresh(boardCacheKey,collect,() => stats.errors.push(`${provider.name}: board refresh active in another process; using available cache.`));else await collect();
    },{signal:this.signal});
    stats.timings.collectionMs=performance.now()-collectionStarted;
    if (stats.incompleteEvidence) stats.errors.push(`${provider.name}: ${stats.incompleteEvidence} postings lacked complete keyword evidence; coverage is partial.`);
    stats.boardsRefreshed = refreshes;stats.boardsSkipped = boards.length-stats.boardsVisited;stats.boardsBlocked = providerBlocked ? stats.boardsSkipped : 0;
    if (stats.detailRequests >= this.maxEnrichments) stats.errors.push(`${provider.name}: detail request budget reached; unmatched unknown attributes remain excluded.`);
    if (changes.length && provider.kind !== 'feed') {
      try {await this.cache.update('inventory',provider.name,current => mergeInventory(current,{...inventory,boards:changes}));}
      catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: inventory cache write failed: ${error.message}`);}
    }
    stats.complete = discovery.complete && stats.boardsVisited === boards.length && !stats.staleBoards && !stats.partialBoards && !stats.errors.length;
    if (!stats.complete) stats.errors.push(`${provider.name}: partial coverage (${stats.boardsVisited}/${boards.length} known boards; ${stats.staleBoards} stale).`);
    if (!stats.boardsVisited) throw new Error(`${provider.name}: no board data could be collected. ${stats.errors.slice(0,3).join(' | ')}`);
    this.report(provider.name,'filtering and deduplicating');
    const jobs = engine.sort([...results.values()].filter(job=>!options.dateSeconds || engine.evaluate(job).match)).slice(0,options.limit);
    stats.coverage={complete:stats.complete,boardsKnown:stats.boardsKnown,boardsVisited:stats.boardsVisited,boardsSkipped:stats.boardsSkipped,staleBoards:stats.staleBoards,partialBoards:stats.partialBoards,acceptedAfterFiltering:stats.acceptedAfterFiltering,refreshedBoardKeys:stats.refreshedBoardKeys,skippedBoardKeys:stats.skippedBoardKeys};
    {
      const changed = new Map(changes.map(board => [boardKey(board),board]));
      const ttl = Math.max(0,Math.min(stats.complete ? CACHE_TTL.search : CACHE_TTL.partialSearch,dateValidUntil-this.now(),...refs.map(ref=>Date.parse(ref.validUntil)-this.now()),...jobs.map(job => job.expiresAt ? Date.parse(job.expiresAt)-this.now() : CACHE_TTL.search),...jobs.map(job => (Date.parse(job.cacheFetchedAt) || this.now()) + (job.cacheStatus === 'stale' ? CACHE_TTL.stale : sourceTtl) - this.now())));
      try {await this.cache.put('search',key,{jobs,stats,refs,coverage:stats.coverage,dateValidUntil,parserVersion:PARSER_VERSION,cachePolicyVersion:2,inventoryFingerprint:inventoryFingerprint({...inventory,boards:inventory.boards.map(board => changed.get(boardKey(board)) || board)})},{ttl});}
      catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: search cache write failed: ${error.message}`);}
    }
    stats.complete = stats.complete && !stats.errors.length;
    return {jobs,stats};
  }
}

function feedInventory(provider) {return {provider:provider.name,boards:[{id:'public-feed',region:'global',status:'valid'}],cursors:{}};}
// A date match can enter (future/uncertain posting) or leave the rolling window.
// Include rejected candidates too, so an empty cached result cannot hide new eligibility.
export function nextDateBoundary(job,seconds,now) {
 if(!validSourceDate(job.postedAt))return Infinity;
 const time=Date.parse(job.postedAt),window=seconds*1000;
 const [entry,exit]=job.datePrecision==='instant'?[time,time+window]:job.datePrecision==='day'?[time+38*3600000,time-14*3600000+window]:[];
 return Math.min(entry>now?entry:Infinity,exit>=now?exit:Infinity);
}
