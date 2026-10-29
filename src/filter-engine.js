import {evaluateJob} from './filters.js';
import {relevance,rankJobs} from './relevance.js';

export class FilterEngine {
  constructor(options,{now = Date.now} = {}) {this.options = options;this.now = now;}
  keywords(job) {
    return relevance(job,this.options.search,{now:this.now()}).match;
  }
  evaluate(job) {
    const options = this.options;
    const lexical = relevance(job,options.search,{now:this.now()});
    const result = evaluateJob(job,{...options,provider:job.source,supportedFacets:[]},this.now());
    if (options.company && options.strict && job.companyEvidence !== 'observed') result.unknowns.push('company');
    const hardFilterStatus = !result.failures.length && !result.unknowns.length && !result.facetReliant.length;
    if (!lexical.match) result.failures.push('search');
    result.match = hardFilterStatus && lexical.match;
    return {...result,relevanceScore:lexical.score,matchedTerms:lexical.matchedTerms,missingTerms:lexical.missingTerms,hardFilterStatus,uncertainty:lexical.uncertainty,needsEnrichment:lexical.needsEnrichment};
  }
  sort(jobs) {
    return rankJobs(jobs,this.options,{now:this.now()});
  }
}
