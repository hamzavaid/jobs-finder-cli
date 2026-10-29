const pending = new WeakMap();
/** Share requests within a transport lifetime without retaining responses indefinitely. */
export async function enrichOnce(provider,board,job,http) {
  let requests = pending.get(http);if (!requests) {requests = new Map();pending.set(http,requests);}
  const key = `${provider.name}:${job.id}`;
  if (!requests.has(key)) requests.set(key,Promise.resolve().then(() => provider.enrichJob(board,job,http)));
  try {return await requests.get(key);} finally {requests.delete(key);}
}
export function preserveEnrichment(previous,current) {
  if (!previous) return current;
  // Publication dates and descriptions from detail APIs survive lighter list refreshes.
  const merged = {...previous,...current};
  for (const key of ['description','postedAt','datePrecision','requisitionId']) if (current[key] == null) merged[key] = previous[key] ?? null;
  if (!current.description && previous.description) {
    merged.descriptionCompleteness = previous.descriptionCompleteness;
    merged.apiDetailsFetched = previous.apiDetailsFetched;
  }
  return merged;
}
