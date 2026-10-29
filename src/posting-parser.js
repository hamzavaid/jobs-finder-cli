import {load} from 'cheerio';import {structuredJobs,structuredFields,normalizeJob,plainText} from './schema.js';import {canonicalizeUrl} from './public-http.js';import {stableKey} from './cache.js';import {extractPublicLinks} from './employer-candidate.js';
export function parsePosting(html,url,{source='Employer'}={}) {
 const canonical=canonicalizeUrl(url),$=load(html);let fields=structuredJobs(html).map(structuredFields).find(job=>job.title)||null;
 if(!fields){const scoped=$('[itemscope][itemtype="https://schema.org/JobPosting"], [itemscope][itemtype="http://schema.org/JobPosting"]').first();if(scoped.length)fields={title:scoped.find('[itemprop="title"]').text().trim()||null,company:scoped.find('[itemprop="hiringOrganization"]').text().trim()||null,description:plainText(scoped.find('[itemprop="description"]').html())};}
 const atsLinks=extractPublicLinks(html,{base:canonical});if(!fields)return {status:'unsupported',job:null,links:atsLinks};
 const complete=!!(fields.title&&fields.company&&fields.description);const job=normalizeJob({...fields,source,id:stableKey(canonical),url:canonical,canonicalUrl:canonical,sourceUrl:url,discoveryUrl:url,applicationUrl:canonical,companyEvidence:fields.company?'observed':null,descriptionCompleteness:fields.description?'complete':'title-only',resolutionStatus:complete?'complete':'incomplete',provenance:[{source,url:canonical,method:'public-jobposting'}]});
 return {status:job.title?complete?'complete':'incomplete':'unsupported',job:job.title?job:null,links:atsLinks};
}
