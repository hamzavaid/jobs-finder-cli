import {load} from 'cheerio';import {structuredJobs,structuredFields,normalizeJob,plainText} from './schema.js';import {canonicalizeUrl} from './public-http.js';import {stableKey} from './cache.js';import {extractPublicLinks} from './employer-candidate.js';
export const POSTING_PARSER_VERSION=2;
function selectPosting(records,canonical) {
 const requested=new URL(canonical),pathId=requested.pathname.split('/').filter(Boolean).at(-1);
 const candidates=records.map(raw=>{
  const urls=[raw.url,raw['@id'],raw.mainEntityOfPage].map(value=>typeof value==='object'?value?.['@id']||value?.url:value).filter(value=>typeof value==='string' && value.trim());
  let identities;try{identities=urls.map(value=>canonicalizeUrl(new URL(value,canonical).toString()));}catch{return {raw,conflict:true};}
  const identifier=typeof raw.identifier==='object'?raw.identifier?.value:raw.identifier;
  // Requisition numbers and URL slugs can legitimately differ. Compare numeric URL IDs only.
  const comparable=/^\d+$/.test(pathId||'') && /^\d+$/.test(String(identifier??''));
  const conflict=identities.some(value=>value!==canonical) || comparable && String(identifier)!==pathId;
  return {raw,conflict,match:identities.includes(canonical)||comparable&&String(identifier)===pathId,identified:identities.length||comparable};
 });
 const matched=candidates.filter(item=>item.match);
 if(matched.length===1 && !matched[0].conflict)return matched[0].raw;
 if(!matched.length && candidates.length===1 && !candidates[0].identified && !candidates[0].conflict)return candidates[0].raw;
 return null;
}
export function parsePosting(html,url,{source='Employer'}={}) {
 const canonical=canonicalizeUrl(url),$=load(html),records=structuredJobs(html),selected=selectPosting(records,canonical);let fields=selected?structuredFields(selected):null;
 if(!records.length){const scoped=$('[itemscope][itemtype="https://schema.org/JobPosting"], [itemscope][itemtype="http://schema.org/JobPosting"]');if(scoped.length===1)fields={title:scoped.find('[itemprop="title"]').text().trim()||null,company:scoped.find('[itemprop="hiringOrganization"]').text().trim()||null,description:plainText(scoped.find('[itemprop="description"]').html())};}
 const atsLinks=extractPublicLinks(html,{base:canonical});if(!fields)return {status:'unsupported',job:null,links:atsLinks};
 const complete=!!(fields.title&&fields.company&&fields.description);const job=normalizeJob({...fields,source,id:stableKey(canonical),url:canonical,canonicalUrl:canonical,sourceUrl:url,discoveryUrl:url,applicationUrl:canonical,companyEvidence:fields.company?'observed':null,descriptionCompleteness:fields.description?'complete':'title-only',resolutionStatus:complete?'complete':'incomplete',provenance:[{source,url:canonical,method:'public-jobposting'}]});
 return {status:job.title?complete?'complete':'incomplete':'unsupported',job:job.title?job:null,links:atsLinks};
}
