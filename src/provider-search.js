import {evaluateJob, normalizeCompany,FILTER_VERSION} from './filters.js';
import {assertPublicHtml} from './http.js';
import {normalizeJob,validateJob} from './schema.js';
import {PARSER_VERSION} from './schema.js';
import {CacheManager,stableKey} from './cache.js';
import {assertProviderAccess,allowedHtmlUrl,failureStatus,providerError,HTML_TTL} from './provider-access.js';
import {htmlFilterSupport} from './provider-filter-map.js';
import {searchEvidence} from './relevance.js';
import {mergeJobEvidence} from './field-evidence.js';

export function assertSearchPage(html, cards, emptyPattern, site) {
  assertPublicHtml(html);
  if (!cards.length && !emptyPattern.test(html)) throw providerError(`${site}: unrecognized search HTML (login, client-rendered page or markup change); no results could be verified.`,'schema_changed','UNRECOGNIZED_PAGE');
}
/** Common bounded sequential pagination and evidence-aware filtering. */
export async function searchProvider(provider, options, http, onProgress = () => {}, context = {}) {
  assertProviderAccess(provider,options,context);
  if (!provider.accessPolicy && !provider.cacheSearch) return collectPages(provider,options,http,onProgress,context);
  const now=context.now||Date.now;
  const started=performance.now();
  let cache=context.cache===false?null:context.cache||new CacheManager({signal:context.signal,now,lockTimeoutMs:120000});
  const cacheWarnings=[];
  const cacheWarning=error=>{if(error.name==='AbortError'||context.signal?.aborted)throw error;cacheWarnings.push(`${provider.name}: cache unavailable: ${error.message}`);};
  const safeRead=async(kind,key)=>{try{return await cache?.read(kind,key);}catch(error){cacheWarning(error);return null;}};
  const safePut=async(...args)=>{try{return await cache?.put(...args);}catch(error){cacheWarning(error);}};
  const criteria=Object.fromEntries(Object.entries(options).filter(([key])=>!['websites','website','format','output','save'].includes(key)));
  const key=stableKey({provider:provider.name,criteria,parserVersion:PARSER_VERSION,filterVersion:FILTER_VERSION,access:'public-html-v1'});
  const run=async()=> {
    context.signal?.throwIfAborted();
    const cached=await safeRead('html-search',key);
    const compatible=cached?.data.parserVersion===PARSER_VERSION && cached.data.jobs.every(job=>job.source===provider.name && validateJob(job).valid);
    if (compatible && cache.fresh(cached)) {
      context.report?.(provider.name,'exact-search cache hit');
      const filteringStarted=performance.now(),jobs=cached.data.jobs.filter(job=>evaluateJob(job,{...options,provider:provider.name,supportedFacets:[]},now()).match);
      return {jobs,stats:{...cached.data.stats,exactCacheHit:true,fromCache:true,pages:0,cardsSeen:0,rejected:cached.data.jobs.length-jobs.length,acceptedAfterFiltering:jobs.length,httpRequests:0,httpAttempts:0,httpRetries:0,timings:{collectionMs:0,filteringMs:performance.now()-filteringStarted},detailRequests:0,detailCacheHits:0,durationMs:performance.now()-started}};
    }
    const cooldown=await safeRead('html-policy',`block:${provider.name}`);
    let result;
    try {
      if (cache?.fresh(cooldown)) throw providerError(`${provider.name}: ${cooldown.data.status} cooldown until ${new Date(cooldown.data.retryAt).toISOString()}. Open in your browser: ${provider.searchUrl(options)}`,cooldown.data.status,'PROVIDER_COOLDOWN');
      result=await collectPages(provider,options,http,onProgress,{...context,cache:cache?{read:safeRead,put:safePut,fresh:record=>cache.fresh(record)}:null,now});
      const failure=result.stats.stopError;
      if(failure) await rememberBlock(failure);
    } catch(error) {
      if(context.signal?.aborted||error.name==='AbortError') throw error;
      await rememberBlock(error);
      if(compatible && now()-Date.parse(cached.updatedAt)<=HTML_TTL.stale) {
        return {jobs:cached.data.jobs.filter(job=>evaluateJob(job,{...options,provider:provider.name,supportedFacets:[]},now()).match).map(job=>({...job,cacheStatus:'stale'})),stats:{...cached.data.stats,status:'partial',complete:false,fromCache:true,stale:true,httpRequests:error.searchStats?.httpRequests||0,httpAttempts:error.searchStats?.httpAttempts??(error.code==='PROVIDER_COOLDOWN'?0:null),httpRetries:error.searchStats?.httpRetries??null,timings:{collectionMs:performance.now()-started},detailRequests:error.searchStats?.detailRequests||0,durationMs:performance.now()-started,errors:[...cached.data.stats.errors,`${provider.name}: stale cached results; refresh ${failureStatus(error)}: ${error.message}`]}};
      }
      if(['blocked','restricted','rate_limited'].includes(failureStatus(error))&&!error.message.includes('browser:'))error.message+=` Open in your browser: ${provider.searchUrl(options)}`;
      throw error;
    }
    const stats={...result.stats,exactCacheHit:false,exactCacheMissReason:compatible?'expired':'missing or incompatible parser/filter key'};delete stats.stopError;
    await safePut('html-search',key,{parserVersion:PARSER_VERSION,jobs:result.jobs,stats},{ttl:stats.complete?HTML_TTL.search:HTML_TTL.partial});
    try {await cache?.pruneIfDue?.();}catch(error){cacheWarning(error);}
    if(cacheWarnings.length) {stats.errors=[...stats.errors,...new Set(cacheWarnings)];stats.complete=false;stats.status='partial';}
    return {jobs:result.jobs,stats};
  };
  async function rememberBlock(error) {
    const status=failureStatus(error);
    if(!['blocked','restricted','rate_limited'].includes(status)||error.code==='PROVIDER_COOLDOWN') return;
    const retryAt=Math.max(now()+HTML_TTL.block,Number.isFinite(error.retryAt)?error.retryAt:0);
    await safePut('html-policy',`block:${provider.name}`,{status,retryAt},{ttl:retryAt-now()});
  }
  // Serialize identical cross-process misses, then recheck inside the lock.
  if(!cache)return run();
  let collected;
  try {return await cache.withLock('html-search',`${key}:collect`,async()=>collected=await run());}
  catch(error) {
    if(!['EACCES','EPERM','ENOSPC','EROFS','ENOTDIR'].includes(error.code))throw error;
    cacheWarning(error);
    if(collected) {collected.stats.errors.push(...cacheWarnings);return collected;}
    cache=null;return run();
  }
}
async function collectPages(provider, options, http, onProgress, context) {
  const detailCache=(provider.accessPolicy || provider.cacheSearch) && context.cache || null;
  const results = new Map(), seen = new Set();
  const stats = {pages:0, cardsSeen:0, detailRequests:0, detailCacheHits:0, rejected:0, unknownExcluded:0, facetReliant:[], errors:[],status:'ok',complete:true,httpRequests:0,accessMode:'public-html',unsupportedFilters:['under','verified'].filter(key=>options[key]!=null && htmlFilterSupport[provider.name]?.[key]==='unsupported')};
  stats.filterSupport=htmlFilterSupport[provider.name];
  const transport=http;stats.httpAttempts=transport.attemptMetrics?0:null;stats.httpRetries=transport.attemptMetrics?0:null;
  http={get:(url,options={})=>{stats.httpRequests++;return transport.get(url,{...options,beforeRequest:async()=>{
    await options.beforeRequest?.();
    const denial=await detailCache?.read('html-policy',`block:${provider.name}`);
    if(detailCache?.fresh(denial))throw providerError(`${provider.name}: ${denial.data.status} cooldown until ${new Date(denial.data.retryAt).toISOString()}.`,denial.data.status,'PROVIDER_COOLDOWN');
  },onAttempt:attempt=>{stats.httpAttempts=(stats.httpAttempts||0)+1;if(attempt.retry)stats.httpRetries=(stats.httpRetries||0)+1;options.onAttempt?.(attempt);}});}};
  const visited=new Set(), started=performance.now(),now=context.now||Date.now;
  if(provider.name==='Glassdoor' && options.location) stats.errors.push('Glassdoor: location is evaluated locally; the public search route does not establish geographic coverage.');
  const facets = new Set();
  const evaluation = {...options, provider:provider.name, supportedFacets:provider.facets(options)};
  let offset = 0, nextUrl = null;
  try {
    if (provider.prepareHttp) http = await provider.prepareHttp(http,context);
    for (let page = 0; page < options.pages && results.size < options.limit; page++) {
      context.signal?.throwIfAborted();
      const url=nextUrl || provider.searchUrl(options, offset, page);
      if(provider.accessPolicy) allowedHtmlUrl(url,provider);
      if(visited.has(url)) {stats.complete=false;stats.errors.push(`${provider.name}: repeated pagination URL; stopped.`);break;}
      visited.add(url);
      const html = await http.get(url);
      assertPublicHtml(html);
      const cards = provider.parseCards(html);
      // Spend scarce detail capacity on likely query matches before exploration.
      const priority=new Map(cards.map(card=>{const evidence=searchEvidence(card,options.search);return [card,(evidence.match?100:0)+evidence.matchedTerms.length];}));
      cards.sort((a,b)=>priority.get(b)-priority.get(a));
      stats.schemaRejected=(stats.schemaRejected||0)+(cards.schemaRejected||0);
      assertSearchPage(html, cards, provider.emptyPattern, provider.name);
      stats.pages++;
      if (!cards.length) break;
      let fresh = 0;
      for (const [cardIndex,card] of cards.entries()) {
        if (seen.has(card.id)) continue;
        seen.add(card.id); fresh++; stats.cardsSeen++;
        if (options.company && normalizeCompany(card.company) !== normalizeCompany(options.company)) {stats.rejected++; continue;}
        const initial = evaluateJob(card, {...evaluation, strict:false},now());
        if (initial.failures.length) {stats.rejected++; continue;}
        if(provider.accessPolicy && initial.unknowns.some(key=>['under','verified'].includes(key))) {stats.rejected++;stats.unknownExcluded++;continue;}
        let job = card;
        const lexical=searchEvidence(card,options.search);
        if(!lexical.match && !lexical.needsEnrichment) {stats.rejected++;continue;}
        const unresolved=[...initial.unknowns,...initial.facetReliant,...(options.strict?initial.inferredFilters:[])];
        const exploratory=!lexical.match && !lexical.matchedTerms.length && !options.details;
        const canExplore=!exploratory || (stats.exploratoryDetails||0)<2;
        if (unresolved.length || !card.detailsFetched && (options.details || lexical.needsEnrichment)) {
          const detailKey=`${provider.name}:${card.id}:${PARSER_VERSION}:${FILTER_VERSION}`,cached=await detailCache?.read('html-detail',detailKey);
          if(detailCache?.fresh(cached) && cached.data.parserVersion===PARSER_VERSION && cached.data.job.id===card.id && cached.data.job.source===provider.name) {job=mergeJobEvidence(cached.data.job,card);stats.detailCacheHits++;}
          else if(canExplore && stats.detailRequests<25) {
            stats.detailRequests++;
            if(exploratory)stats.exploratoryDetails=(stats.exploratoryDetails||0)+1;
            try {
              const detailUrl=provider.detailUrl(card.id, card);
              if(provider.accessPolicy) allowedHtmlUrl(detailUrl,provider,{detail:true});
              const detail=await http.get(detailUrl);assertPublicHtml(detail);job=provider.parseDetail(detail,card);
              if(provider.accessPolicy && (job.id!==card.id || !validateJob(normalizeJob(job)).valid)) throw providerError(`${provider.name}: invalid detail identity.`,'schema_changed','DETAIL_IDENTITY');
              await detailCache?.put('html-detail',detailKey,{parserVersion:PARSER_VERSION,job},{ttl:HTML_TTL.detail});
            } catch(error) {
              if(error.name==='AbortError'||context.signal?.aborted) throw error;
              if(['blocked','restricted','rate_limited'].includes(failureStatus(error))) {
                const summary=normalizeJob({...card,source:provider.name,resolutionStatus:'incomplete'});
                const decision=evaluateJob(summary,evaluation,now());
                if(decision.match && searchEvidence(summary,options.search).match && validateJob(summary).valid)results.set(summary.id,{...summary,inferredFilters:decision.inferredFilters,filterEvidence:decision.inferredFilters.length?'title-supplemented':'observed-or-unfiltered'});
                throw error;
              }
              stats.errors.push(`${provider.name}: incomplete detail ${card.id}: ${error.message}`);job={...card,resolutionStatus:'incomplete'};
            }
          } else if(canExplore) {stats.complete=false;if(!stats.errors.some(error=>error.includes('detail budget')))stats.errors.push(`${provider.name}: detail budget reached.`);}
        }
        const decision = evaluateJob(job, evaluation,now());
        if(!searchEvidence(job,options.search).match) {
          stats.rejected++;stats.keywordExcluded=(stats.keywordExcluded||0)+1;
          if(!job.detailsFetched) {stats.unknownExcluded++;stats.incompleteKeywords=(stats.incompleteKeywords||0)+1;}
          continue;
        }
        if (!decision.match) {
          stats.rejected++;
          if (decision.unknowns.length || decision.facetReliant.length) stats.unknownExcluded++;
          stats.facetUnconfirmed=(stats.facetUnconfirmed||0)+decision.facetReliant.length;
          continue;
        }
        const titleSupplement=decision.inferredFilters.length>0;
        job = normalizeJob({...job, source:provider.name,
          filterEvidence:titleSupplement?'title-supplemented':'observed-or-unfiltered',
          inferredFilters:decision.inferredFilters,
          unconfirmedFilters:decision.facetReliant});
        if (!validateJob(job).valid) {stats.rejected++;stats.errors.push(`${provider.name}: malformed posting quarantined (schema drift).`);continue;}
        decision.facetReliant.forEach(f => facets.add(f));
        results.set(job.id, job);
        if (results.size >= options.limit) {
          if(cardIndex<cards.length-1) {stats.complete=false;if(provider.accessPolicy)stats.errors.push(`${provider.name}: result budget reached before every card was evaluated.`);}
          break;
        }
      }
      onProgress({page:page + 1, received:cards.length, accepted:results.size});
      context.report?.(provider.name,`${results.size} matches; page ${page+1}/${options.pages}`);
      if (!fresh) {stats.complete=false;stats.errors.push(`${provider.name}: repeated postings; pagination stalled.`);break;}
      offset += provider.pageSize || cards.length;
      if (provider.nextPage) {
        nextUrl = provider.nextPage(html);
        if (!nextUrl) break;
      }
      if(page+1>=options.pages || results.size>=options.limit) {stats.complete=false;stats.errors.push(`${provider.name}: search stopped at page/result budget; further results may exist.`);}
    }
  } catch (error) {
    if(error.name==='AbortError'||context.signal?.aborted) throw error;
    error.providerStatus=failureStatus(error);
    if (!results.size) {error.searchStats={...stats,timings:{collectionMs:performance.now()-started}};throw error;}
    stats.complete=false;stats.stopError=error;stats.stopStatus=error.providerStatus;
    stats.errors.push(`${provider.name}: partial results; stopped after ${error.message}`);
  }
  stats.facetReliant = [...facets];
  if(stats.incompleteKeywords)stats.errors.push(`${provider.name}: ${stats.incompleteKeywords} candidates excluded because keyword evidence remained incomplete.`);
  if(stats.errors.length) stats.complete=false;
  stats.status=stats.complete?(results.size?'ok':'empty'):'partial';
  stats.durationMs=performance.now()-started;stats.timings={collectionMs:stats.durationMs};stats.observedAt=new Date(now()).toISOString();stats.jobsAccepted=results.size;stats.acceptedAfterFiltering=results.size;
  return {jobs:[...results.values()], stats};
}
