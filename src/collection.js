import {CacheManager,CACHE_TTL,stableKey} from './cache.js';
import {DiscoveryManager,inventoryFingerprint,mergeInventory} from './discovery.js';
import {createApiClient} from './api-http.js';
import {FilterEngine} from './filter-engine.js';
import {boardKey,emptyStats} from './ats/shared.js';
import {mapConcurrent} from './concurrency.js';

export function searchCacheKey(options,provider) {
  const {search,company,location,dateSeconds,remote,workplace,experience,employment,under,verified,limit,pages,sort,details,strict,websites} = options;
  return stableKey({provider,search:search.toLowerCase().replace(/\s+/g,' '),company:company.toLowerCase().replace(/\s+/g,' '),location:location.toLowerCase().replace(/\s+/g,' '),dateSeconds,remote,workplace,experience,employment,under,verified,limit,pages,sort,details,strict,websites:[...websites].sort()});
}
export class CollectionManager {
  constructor({cache,http,signal,report = () => {},now = Date.now,maxBoards = 64,discoveryOptions = {}} = {}) {
    Object.assign(this,{signal,report,now,maxBoards,discoveryOptions});
    this.cache = cache || new CacheManager({signal,onWarning:message => report('Cache',message)});
    this.http = http || createApiClient({signal});
  }
  async find(provider,options) {
    const stats = {...emptyStats(),boardsKnown:0,boardsVisited:0,cacheHits:0,staleBoards:0,complete:false,duplicatesRemoved:0,partialBoards:0,failedBoards:0};
    const discovery = await new DiscoveryManager({cache:this.cache,http:this.http,signal:this.signal,report:this.report,now:this.now,...this.discoveryOptions}).ensure(provider);
    const inventory = discovery.inventory;
    stats.errors.push(...discovery.errors);
    const fingerprint = inventoryFingerprint(inventory), key = searchCacheKey(options,provider.name);
    const exact = await this.cache.read('search',key);
    if (!options.dateSeconds && exact && this.cache.fresh(exact) && exact.data.inventoryFingerprint === fingerprint) {
      const valid = await mapConcurrent(exact.data.refs,2,async ref => {
        const cached = await this.cache.read('postings',ref.key);
        return this.cache.fresh(cached) && cached.data.revision === ref.revision;
      },{signal:this.signal});
      if (valid.every(Boolean)) {this.report(provider.name,'exact search cache loaded');return {jobs:exact.data.jobs,stats:{...exact.data.stats,pages:0,cardsSeen:0,detailRequests:0,rejected:0,unknownExcluded:0,errors:[...new Set([...exact.data.stats.errors,...discovery.errors])],complete:exact.data.stats.complete && discovery.complete,cacheHits:exact.data.refs.length,exactCacheHit:true}};}
    }
    const boards = inventory.boards.filter(board => board.status === 'valid' || board.status === 'pending');
    if (!boards.length) throw new Error(`${provider.name}: no validated boards available${discovery.errors.length ? '; ' + discovery.errors.join(' | ') : '; discovery or validation is incomplete'}.`);
    stats.boardsKnown = boards.length;
    const engine = new FilterEngine(options,{now:this.now}), results = new Map(),refs = [],changes = [];
    const snapshots = boards.map(board => ({board,key:`${provider.name}:${boardKey(board)}`}));
    // Read large posting shards only inside the two-worker loop, never all at once.
    snapshots.sort((a,b) => (Date.parse(a.board.lastJobFetchAt) || 0) - (Date.parse(b.board.lastJobFetchAt) || 0) || boardKey(a.board).localeCompare(boardKey(b.board)));
    let refreshes = 0,providerBlocked = Date.parse(inventory.providerRetryAt) > this.now();
    this.report(provider.name,`fetching jobs: 0 / ${boards.length} boards`);
    await mapConcurrent(snapshots,2,async ({board,key:boardCacheKey}) => {
      const cached = await this.cache.read('postings',boardCacheKey);
      this.signal?.throwIfAborted();
      let record = cached,dirty = false;
      const contentNeeded = provider.name === 'Greenhouse' && options.details;
      const fresh = this.cache.fresh(cached) && (!contentNeeded || cached.data.content) && (cached.data.complete || (cached.data.pages || 0) >= options.pages);
      if (fresh) stats.cacheHits++;
      else if (providerBlocked || refreshes >= this.maxBoards || (board.retryAt && Date.parse(board.retryAt) > this.now())) {
        if (!cached || !this.cache.usableStale(cached)) return;
        stats.staleBoards++;
      } else {
        refreshes++;
        try {
          if (options.company && provider.fetchCompany && !board.company) board.company = await provider.fetchCompany(board,this.http);
          const outcome = await provider.fetchBoard(board,this.http,{pages:options.pages,content:contentNeeded});
          const boardRetryAt = outcome.errorStatus ? outcome.retryAt || new Date(this.now() + 15 * 60000).toISOString() : null;
          if ([401,403,429].includes(outcome.errorStatus)) {providerBlocked = true;inventory.providerRetryAt = boardRetryAt;}
          stats.pages += outcome.pages;
          const fetchedAt = new Date(this.now()).toISOString();
          const updated = {provider:provider.name,board,jobs:outcome.jobs.map(job => ({...job,lastObservedAt:fetchedAt})),lastSuccessfulFetchAt:outcome.complete ? fetchedAt : cached?.data.lastSuccessfulFetchAt || cached?.updatedAt || fetchedAt,complete:outcome.complete,pages:outcome.pages,content:contentNeeded,
            revision:stableKey(outcome.jobs.map(({fetchedAt,...job}) => job))};
          // A truncated fetch never replaces a complete board inventory.
          if (!outcome.complete && cached) {
            const jobs = new Map(cached.data.jobs.filter(job => this.now() - Date.parse(job.lastObservedAt || cached.data.lastSuccessfulFetchAt || cached.updatedAt) <= CACHE_TTL.stale).map(job => [job.id,job]));
            for (const job of updated.jobs) jobs.set(job.id,job);
            updated.jobs = [...jobs.values()];updated.revision = stableKey(updated.jobs);
          }
          record = {data:updated,updatedAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now() + CACHE_TTL.postings).toISOString()};dirty = true;
          changes.push({...board,status:'valid',lastJobFetchAt:new Date(this.now()).toISOString(),lastValidatedAt:new Date(this.now()).toISOString(),validationAttemptAt:new Date(this.now()).toISOString(),retryAt:boardRetryAt});
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
      stats.boardsVisited++;
      if (!record.data.complete) stats.partialBoards++;
      const enriched = [];
      for (let job of record.data.jobs) {
        if (stats.cardsSeen && stats.cardsSeen % 512 === 0) {await new Promise(resolve => setImmediate(resolve));this.signal?.throwIfAborted();}
        stats.cardsSeen++;
        if (job.lastObservedAt && this.now() - Date.parse(job.lastObservedAt) > CACHE_TTL.stale) continue;
        if (provider.name === 'Greenhouse' && (options.dateSeconds || options.strict) && engine.keywords(job)) {
          const precheck = engine.evaluate(job);
          const enrichable = precheck.unknowns.some(field => !['under','verified'].includes(field));
          if (!job.apiDetailsFetched && !precheck.failures.length && (options.dateSeconds && !job.postedAt || options.strict && enrichable) && stats.detailRequests < 200) {
            try {stats.detailRequests++;job = await provider.fetchDetail(board,job.providerJobId,this.http);dirty = true;}
            catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: detail ${job.providerJobId}: ${error.message}`);}
          }
        }
        enriched.push(job);
        const decision = engine.evaluate(job);
        if (!decision.match) {stats.rejected++;if (decision.unknowns.length) stats.unknownExcluded++;continue;}
        if (results.has(job.id)) stats.duplicatesRemoved++;
        results.set(job.id,{...job,cacheStatus:this.cache.fresh(record) && (!job.lastObservedAt || this.now() - Date.parse(job.lastObservedAt) < CACHE_TTL.postings) ? 'fresh' : 'stale',cacheFetchedAt:job.lastObservedAt || record.data.lastSuccessfulFetchAt || record.updatedAt});
        if (results.size > options.limit * 2) {
          const best = engine.sort([...results.values()]).slice(0,options.limit);results.clear();for (const row of best) results.set(row.id,row);
        }
      }
      if (dirty) {
        record.data.jobs = enriched;record.data.revision = stableKey(enriched.map(({fetchedAt,...job}) => job));
        const remaining = Math.max(0,Date.parse(record.expiresAt) - this.now());
        try {record = await this.cache.put('postings',boardCacheKey,record.data,{ttl:remaining});}
        catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: board cache write failed: ${error.message}`);}
      }
      refs.push({key:boardCacheKey,revision:record.data.revision});
      this.report(provider.name,`fetching jobs: ${stats.boardsVisited} / ${boards.length} boards`);
    },{signal:this.signal});
    if (stats.detailRequests >= 200) stats.errors.push(`${provider.name}: detail request budget reached; unmatched unknown attributes remain excluded.`);
    if (changes.length) {
      try {await this.cache.update('inventory',provider.name,current => mergeInventory(current,{...inventory,boards:changes}));}
      catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: inventory cache write failed: ${error.message}`);}
    }
    stats.complete = discovery.complete && stats.boardsVisited === boards.length && !stats.staleBoards && !stats.partialBoards && !stats.errors.length;
    if (!stats.complete) stats.errors.push(`${provider.name}: partial coverage (${stats.boardsVisited}/${boards.length} known boards; ${stats.staleBoards} stale).`);
    if (!stats.boardsVisited) throw new Error(`${provider.name}: no board data could be collected. ${stats.errors.slice(0,3).join(' | ')}`);
    this.report(provider.name,'filtering and deduplicating');
    const jobs = engine.sort([...results.values()]).slice(0,options.limit);
    if (!stats.staleBoards && !options.dateSeconds) {
      const changed = new Map(changes.map(board => [boardKey(board),board]));
      const ttl = Math.max(0,Math.min(CACHE_TTL.search,...jobs.map(job => (Date.parse(job.cacheFetchedAt) || this.now()) + (job.cacheStatus === 'stale' ? CACHE_TTL.stale : CACHE_TTL.postings) - this.now())));
      try {await this.cache.put('search',key,{jobs,stats,refs,inventoryFingerprint:inventoryFingerprint({...inventory,boards:inventory.boards.map(board => changed.get(boardKey(board)) || board)})},{ttl});}
      catch (error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: search cache write failed: ${error.message}`);}
    }
    stats.complete = stats.complete && !stats.errors.length;
    return {jobs,stats};
  }
}
