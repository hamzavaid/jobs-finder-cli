import {evaluateJob,normalizeCompany} from './filters.js';

const words = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export class FilterEngine {
  constructor(options,{now = Date.now} = {}) {this.options = options;this.now = now;}
  keywords(job) {
    const query = words(this.options.search);
    if (!query) return true;
    // Literal phrase matching over title/description: no regex execution or occupation assumptions.
    return [job.title,job.description].some(value => words(value).includes(query));
  }
  evaluate(job) {
    const options = this.options;
    if (!this.keywords(job)) return {match:false,failures:['search'],unknowns:[],facetReliant:[]};
    const result = evaluateJob(job,{...options,provider:job.source,supportedFacets:[]},this.now());
    if (options.location) {
      const locations = [job.location,...(job.secondaryLocations || [])].filter(Boolean);
      if (!locations.length) result.unknowns.push('location');
      else if (!locations.some(value => words(value).includes(words(options.location)))) result.failures.push('location');
    }
    if (options.company && options.strict && job.companyEvidence !== 'observed') result.unknowns.push('company');
    result.match = !result.failures.length && !result.unknowns.length;
    return result;
  }
  sort(jobs) {
    const query = words(this.options.search);
    return jobs.sort((a,b) => {
      if (this.options.sort === 'recent') {
        const date = (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0);
        if (date) return date;
      } else {
        const score = job => words(job.title) === query ? 2 : words(job.title).includes(query) ? 1 : 0;
        const difference = score(b) - score(a);if (difference) return difference;
      }
      return `${normalizeCompany(a.company)}:${a.title}:${a.id}`.localeCompare(`${normalizeCompany(b.company)}:${b.title}:${b.id}`);
    });
  }
}
