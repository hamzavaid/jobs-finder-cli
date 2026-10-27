import {findIndeedJobs} from './indeed.js';
import {makeSearchUrl, evaluateJob, normalizeCompany} from './filters.js';
import {parseSearchCards, parseJobDetail, canonicalJobId} from './parser.js';

export async function fetchJob(idOrUrl, http) {
  const id = canonicalJobId(idOrUrl);
  const html = await http.get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  return parseJobDetail(html, {id, url:`https://www.linkedin.com/jobs/view/${id}/`});
}

/** Fetch paginated, public job cards; avoid claiming non-observable facts. */
export async function findLinkedInJobs(options, http, onProgress = () => {}) {
  const results = new Map();
  const seen = new Set();
  const stats = {pages: 0, cardsSeen: 0, detailRequests: 0, rejected: 0, unknownExcluded: 0, facetReliant: new Set()};
  let offset = 0;
  const needsDetails = options.details || options.strict || options.under !== null || options.verified !== null;
  for (let p = 0; p < options.pages && results.size < options.limit; p++) {
    const url = makeSearchUrl(options, offset);
    const cards = parseSearchCards(await http.get(url));
    stats.pages++;
    if (!cards.length) break;
    let newIds = 0;
    for (const card of cards) {
      if (seen.has(card.id)) continue;
      newIds++;
      seen.add(card.id);
      stats.cardsSeen++;
      // Check company locally: LinkedIn guest search does not take company names in f_C.
      if (options.company && normalizeCompany(card.company) !== normalizeCompany(options.company)) {
        stats.rejected++; continue;
      }
      const simpleResult = evaluateJob(card, {...options, strict: false});
      if (simpleResult.failures?.length) {stats.rejected++; continue;}
      let job = card;
      if (needsDetails) {
        const detail = await http.get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${card.id}`);
        job = parseJobDetail(detail, card);
        stats.detailRequests++;
      }
      const decision = evaluateJob(job, options);
      if (!decision.match) {
        stats.rejected++;
        if (decision.unknowns.length || decision.facetReliant.length) stats.unknownExcluded++;
        continue;
      }
      job.filterEvidence = decision.facetReliant.length ? 'linkedin-facet-unconfirmed' : 'observed-or-unfiltered';
      job.unconfirmedFilters = decision.facetReliant;
      for (const f of decision.facetReliant) stats.facetReliant.add(f);
      results.set(job.id, job);
      if (results.size >= options.limit) break;
    }
    onProgress({page: p + 1, received: cards.length, accepted: results.size});
    if (newIds === 0) break; // LinkedIn may repeat one page rather than advance.
    offset += cards.length; // Endpoints sometimes return 10, sometimes 25 jobs.
  }
  return {
    jobs: [...results.values()],
    stats: {...stats, facetReliant: [...stats.facetReliant]}
  };
}

/** Run selected providers sequentially through a shared rate-limited HTTP client. */
export async function findJobs(options, http) {
  const providerJobs = [], allErrors = [];
  const stats = {pages:0, cardsSeen:0, rejected:0, detailRequests:0, unknownExcluded:0,
    facetReliant:[], errors:[], providers:{}};
  let successfulProviders = 0;
  for (const site of options.websites ?? ['LinkedIn','Indeed']) {
    try {
      const outcome = site === 'Indeed' ? await findIndeedJobs(options, http) : await findLinkedInJobs(options, http);
      successfulProviders++;
      stats.providers[site] = {pages:outcome.stats.pages, results:outcome.jobs.length};
      for (const key of ['pages', 'cardsSeen', 'rejected', 'detailRequests', 'unknownExcluded']) stats[key] += outcome.stats[key];
      stats.facetReliant.push(...outcome.stats.facetReliant.map(f => f.startsWith('Indeed:') ? f : `${site}:${f}`));
      providerJobs.push({site, jobs:outcome.jobs});
    } catch (error) {
      const message = `${site}: ${error.message}`;
      allErrors.push(error);
      stats.errors.push(message);
      stats.providers[site] = {error: error.message};
    }
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
  return {jobs:merged, stats};
}
