import {CACHE_TTL} from './cache.js';
import {normalizeJob} from './schema.js';
const pending = new WeakMap();
/** Share requests within a transport lifetime without retaining responses indefinitely. */
export async function enrichOnce(provider,board,job,http) {
  let requests = pending.get(http);if (!requests) {requests = new Map();pending.set(http,requests);}
  const key = `${provider.name}:${board.region || "global"}:${board.id || ""}:${board.domain || ""}:${job.providerJobId || job.id}`;
  if (!requests.has(key)) requests.set(key,Promise.resolve().then(() => provider.enrichJob(board,job,http)));
  try {return await requests.get(key);} finally {requests.delete(key);}
}
export function preserveEnrichment(previous,current) {
  if (!previous) return current;
  // Publication dates and descriptions from detail APIs survive lighter list refreshes.
  const merged = {...previous,...current,firstSeenAt:previous.firstSeenAt || current.firstSeenAt};
  for (const key of ['description','postedAt','datePrecision','requisitionId']) if (current[key] == null) merged[key] = previous[key] ?? null;
  if (previous.description && (!current.description || previous.descriptionCompleteness === 'complete' && current.descriptionCompleteness !== 'complete')) {
    merged.description = previous.description;
    merged.descriptionCompleteness = previous.descriptionCompleteness;
    merged.apiDetailsFetched = previous.apiDetailsFetched;
  }
  return normalizeJob(merged);
}

export function enrichmentFailure(error,now) {
  const oversized=error.code==='RESPONSE_TOO_LARGE'||/exceeds.*size limit|oversized|too large/i.test(error.message);
  const unsupported=[400,404,405,410,501].includes(error.status);
  const structural=oversized||unsupported||/invalid.*payload|schema drift|identity mismatch|invalid JSON/i.test(error.message);
  return {status:'failed',failureKind:oversized?'oversized':unsupported?'unsupported':structural?'structural':'transient',
    attemptedAt:new Date(now).toISOString(),retryAt:error.retryAt || new Date(now+(structural?CACHE_TTL.enrichmentStructural:CACHE_TTL.enrichmentTransient)).toISOString(),message:error.message,httpStatus:error.status || null};
}
export const retryDue=(attempt,now)=>!attempt?.retryAt || Date.parse(attempt.retryAt)<=now;
export function enrichmentPriority(job,decision,options) {
 if(decision.failures.some(field=>field!=='search') || decision.unknowns.some(field=>['under','verified'].includes(field)))return -1;
 return (decision.unknowns.length?100:0)+(options.details?50:0)+decision.matchedTerms.length*10+decision.relevanceScore/100;
}
