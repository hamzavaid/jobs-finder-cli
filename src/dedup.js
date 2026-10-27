/** Conservative cross-source hints. Distinct source records are always retained. */
export function identifyCrossSourceDuplicates(jobs) {
  const links = new Map();
  let possible = 0;
  const output = jobs.map(job => {
    let key;
    try {
      const url = new URL(job.url);
      const specific = /\d{4,}|[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(url.pathname) || [...url.searchParams.keys()].some(name => /^(?:jk|jl|gh_jid|job_?id|requisitionId)$/i.test(name));
      if (!specific) return job;
      url.hash = '';
      for (const name of [...url.searchParams.keys()]) if (/^utm_|^(?:trackingId|source)$/i.test(name)) url.searchParams.delete(name);
      url.searchParams.sort();key = url.toString();
    } catch {return job;}
    const other = links.get(key);
    if (other && other.source !== job.source) {
      possible++;
      return {...job,possibleDuplicateOf:`${other.source}:${other.id}`};
    }
    links.set(key,job);return job;
  });
  return {jobs:output,possible};
}
