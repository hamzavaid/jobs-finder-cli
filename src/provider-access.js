import robotsParser from 'robots-parser';
import {AccessError} from './http.js';

export const HTML_TTL = Object.freeze({search:10*60000,partial:3*60000,detail:6*3600000,robots:6*3600000,block:15*60000,stale:24*3600000});
export function providerError(message,status,code) {
  const error = new AccessError(message);error.providerStatus=status;error.code=code;return error;
}
export function failureStatus(error) {
  if (error.providerStatus) return error.providerStatus;
  if (error.status === 429) return 'rate_limited';
  if ([401,403,999].includes(error.status) || /challenge|login|checkpoint|HTTP (?:401|403)|access is restricted/i.test(error.message)) return 'blocked';
  if (/timed out|timeout/i.test(error.message)) return 'timeout';
  if (/unrecognized|schema|different posting/i.test(error.message)) return 'schema_changed';
  return 'failed';
}
export function assertProviderAccess(provider,options,context={}) {
  if (!provider.accessPolicy) return;
  const grant=context.accessPolicy?.[provider.name];
  if (provider.accessPolicy === 'permission-required' && !(grant?.mode === 'public-html' && typeof grant.evidence === 'string' && grant.evidence.trim())) {
    throw providerError(`${provider.name}: automated collection is restricted without documented provider permission. Open in your browser: ${provider.searchUrl(options)}`,'restricted','POLICY_RESTRICTED');
  }
}
export function allowedHtmlUrl(value,provider,{detail=false}={}) {
  const url = new URL(value);
  const hosts=provider.name==='Indeed'?['www.indeed.com','indeed.com']:['www.glassdoor.com','glassdoor.com'];
  const path=provider.name==='Indeed'? (detail?/^\/viewjob$/:/^\/jobs$/) : (detail?/^\/job-listing\//:/^\/Job\//);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname)||!path.test(url.pathname)) throw providerError(`${provider.name}: refused unsupported public URL.`,'failed','UNSAFE_URL');
  return url.toString();
}
/** Robots rules are additional restrictions, never a substitute for permission. */
export async function policyHttp(http,origin,{cache,now=Date.now,signal}={}) {
  cache=cache||null;
  const key=`robots:${origin}`,cached=await cache?.read('html-policy',key);
  let body=cache?.fresh(cached)?cached.data.body:null;
  if(!body) {
    signal?.throwIfAborted();body=await http.get(`${origin}/robots.txt`);
    if(typeof body!=='string'||!/^\s*user-agent\s*:/im.test(body)||/<html/i.test(body)) throw providerError(`${new URL(origin).hostname}: robots.txt could not be verified; stopped without requesting job pages.`,'restricted','ROBOTS_UNVERIFIED');
    await cache?.put('html-policy',key,{body},{ttl:HTML_TTL.robots});
  }
  const rules=robotsParser(`${origin}/robots.txt`,body);
  return {get:async value=> {
    signal?.throwIfAborted();const url=new URL(value);
    if(url.origin!==origin||url.username||url.password||url.port||rules.isAllowed(url.toString(),'jobs-cli')===false) throw providerError(`${new URL(origin).hostname}: robots.txt disallows ${url.pathname}; public access is restricted.`,'restricted','ROBOTS_DISALLOWED');
    return http.get(url.toString());
  },now};
}
