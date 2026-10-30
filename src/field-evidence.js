// Null means unobserved. Only an explicit removedFields entry retracts evidence.
const fields=['title','company','location','workplace','employmentType','seniorityLevel','description','postedAt','requisitionId','salary','applicantCount','underTenApplicants','verified'];
const known=value=>value!==null && value!==undefined && value!=='';
const evidence=(job,key)=>job?.fieldEvidence?.[key] || {observedAt:job?.lastObservedAt || job?.fetchedAt || null,source:job?.source || null};
export function mergeJobEvidence(previous={},current={}) {
 const merged={...previous,...current,firstSeenAt:previous.firstSeenAt || current.firstSeenAt,fieldEvidence:{...previous.fieldEvidence},removedFields:current.removedFields || []};
 for(const key of fields) {
  const old=evidence(previous,key),fresh=evidence(current,key);
  const older=Number.isFinite(Date.parse(old.observedAt)) && Number.isFinite(Date.parse(fresh.observedAt)) && Date.parse(fresh.observedAt)<Date.parse(old.observedAt);
  const removed=merged.removedFields.includes(key) && !older;
  const richer=key==='description' && previous.descriptionCompleteness==='complete' && current.descriptionCompleteness!=='complete';
  const inferredEmployer=key==='company' && previous.companyEvidence==='observed' && current.companyEvidence==='board-identifier';
  const retain=known(previous[key]) && (older || !known(current[key]) || richer || inferredEmployer) && !removed;
  if(removed) {merged[key]=null;merged.fieldEvidence[key]={...fresh,removed:true};}
  else if(retain) {merged[key]=previous[key];merged.fieldEvidence[key]={...old,retained:true};}
  else if(known(current[key])) merged.fieldEvidence[key]={...fresh,retained:false};
  if(key==='description' && (retain || removed)) {
   merged.descriptionCompleteness=removed?'title-only':previous.descriptionCompleteness;
   merged.apiDetailsFetched=removed?false:previous.apiDetailsFetched;
  }
  if(key==='postedAt' && (retain || removed))merged.datePrecision=removed?null:previous.datePrecision;
  if(key==='company' && retain) {merged.companyEvidence=previous.companyEvidence;merged.employerIdentity=previous.employerIdentity;}
 }
 merged.employer=merged.company;
 return merged;
}
