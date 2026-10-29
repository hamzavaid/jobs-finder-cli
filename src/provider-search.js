import {evaluateJob, normalizeCompany} from './filters.js';
import {assertPublicHtml} from './http.js';
import {normalizeJob} from './schema.js';

export function assertSearchPage(html, cards, emptyPattern, site) {
  assertPublicHtml(html);
  if (!cards.length && !emptyPattern.test(html)) throw new Error(`${site}: unrecognized search HTML (login, client-rendered page or markup change); no results could be verified.`);
}
/** Common bounded sequential pagination and evidence-aware filtering. */
export async function searchProvider(provider, options, http, onProgress = () => {}) {
  const results = new Map(), seen = new Set();
  const stats = {pages:0, cardsSeen:0, detailRequests:0, rejected:0, unknownExcluded:0, facetReliant:[], errors:[]};
  const facets = new Set();
  const evaluation = {...options, provider:provider.name, supportedFacets:provider.facets(options)};
  let offset = 0, nextUrl = null;
  try {
    if (provider.prepareHttp) http = await provider.prepareHttp(http);
    for (let page = 0; page < options.pages && results.size < options.limit; page++) {
      const html = await http.get(nextUrl || provider.searchUrl(options, offset, page));
      const cards = provider.parseCards(html);
      assertSearchPage(html, cards, provider.emptyPattern, provider.name);
      stats.pages++;
      if (!cards.length) break;
      let fresh = 0;
      for (const card of cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id); fresh++; stats.cardsSeen++;
        if (options.company && normalizeCompany(card.company) !== normalizeCompany(options.company)) {stats.rejected++; continue;}
        const initial = evaluateJob(card, {...evaluation, strict:false});
        if (initial.failures.length) {stats.rejected++; continue;}
        let job = card;
        if (options.details || options.strict || (provider.name === 'LinkedIn' && (options.under != null || options.verified != null))) {
          stats.detailRequests++;
          try {job = provider.parseDetail(await http.get(provider.detailUrl(card.id, card)), card);} catch(error) {if (error.name === 'AbortError') throw error;stats.errors.push(`${provider.name}: incomplete detail ${card.id}: ${error.message}`);job = {...card,resolutionStatus:'incomplete'};}
        }
        const decision = evaluateJob(job, evaluation);
        if (!decision.match) {
          stats.rejected++;
          if (decision.unknowns.length || decision.facetReliant.length) stats.unknownExcluded++;
          continue;
        }
        job = normalizeJob({...job, source:provider.name,
          filterEvidence:decision.facetReliant.length ? `${provider.name.toLowerCase()}-facet-unconfirmed` : 'observed-or-unfiltered',
          unconfirmedFilters:decision.facetReliant});
        decision.facetReliant.forEach(f => facets.add(f));
        results.set(job.id, job);
        if (results.size >= options.limit) break;
      }
      onProgress({page:page + 1, received:cards.length, accepted:results.size});
      if (!fresh) break;
      offset += provider.pageSize || cards.length;
      if (provider.nextPage && page + 1 < options.pages && results.size < options.limit) {
        nextUrl = provider.nextPage(html);
        if (!nextUrl) break;
      }
    }
  } catch (error) {
    if (!results.size) throw error;
    stats.errors.push(`${provider.name}: partial results; stopped after ${error.message}`);
  }
  stats.facetReliant = [...facets];
  return {jobs:[...results.values()], stats};
}
