import {PUBLIC_JOB_LISTS} from './employer-candidate.js';
import {setTimeout as delay} from 'node:timers/promises';
import {AccessError} from './http.js';
import {RequestScheduler} from './concurrency.js';

export function assertApiUrl(value) {
  const url = new URL(value);
  const allowed = {
    'boards-api.greenhouse.io':/^\/v1\/boards\/[^/]+(?:\/jobs(?:\/[^/]+)?)?$/,
    'api.lever.co':/^\/v0\/postings\/[^/]+(?:\/[^/]+)?$/,
    'api.eu.lever.co':/^\/v0\/postings\/[^/]+(?:\/[^/]+)?$/,
    'api.ashbyhq.com':/^\/posting-api\/job-board\/[^/]+$/,
    'api.smartrecruiters.com':/^\/v1\/companies\/[^/]+\/postings(?:\/[\w-]+)?$/,
    'himalayas.app':/^\/jobs\/api$/,
    'remotive.com':/^\/api\/remote-jobs$/,
    'raw.githubusercontent.com':/^\/SimplifyJobs\/(?:New-Grad-Positions|Summer2026-Internships)\/dev\/README\.md$/,
    'web.archive.org':/^\/cdx\/search\/cdx$/,
    'index.commoncrawl.org':/^\/(?:collinfo\.json|CC-MAIN-\d{4}-\d{2}-index)$/,
    'urlscan.io':/^\/api\/v1\/search\/$/
  };
  const personio = /^[a-z\d-]+\.jobs\.personio\.(?:de|com)$/.test(url.hostname) && url.pathname === '/xml';
  if (url.protocol !== 'https:' || url.port || url.username || url.password || (!personio && (!Object.hasOwn(allowed,url.hostname) || !allowed[url.hostname].test(url.pathname))) || /%2f|%5c|%00|%25/i.test(url.pathname)) throw new Error('Refusing an untrusted ATS/index request URL.');
  return url;
}
export function retryAfterMs(value,now = Date.now()) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  return Math.max(0,(Date.parse(value) || now) - now);
}
export function createApiClient({retries = 2,random = Math.random,fetchImpl = globalThis.fetch,signal,timeoutMs = 15000,delayMs = 1200,maxBytes = 16 * 1024 * 1024,now = Date.now,sleep = ms => delay(ms,undefined,{signal}),scheduler = new RequestScheduler({signal})} = {}) {
  if (!Number.isInteger(retries) || retries < 0 || retries > 3 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Invalid API HTTP configuration.');
  const metrics = {requests:0,bytes:0,notModified:0};
  const responseCache = new Map();
  const next = new Map(),cooldown = new Map(),gates = new Map();
  async function reserveStart(host) {
    const start = (gates.get(host) || Promise.resolve()).catch(() => {}).then(async () => {
      while (true) {
        signal?.throwIfAborted();
        const slot = Math.max(now(),next.get(host) || 0,cooldown.get(host) || 0);
        const wait = slot - now();
        if (wait > 30000) {const error = new AccessError(`${host}: provider is backed off; retry later.`,429);error.retryAt = new Date(slot).toISOString();throw error;}
        if (wait <= 0) break;
        await sleep(wait);
        // A response can extend the host's cooldown while another caller waits.
      }
      next.set(host,now() + (host === 'urlscan.io' ? Math.max(2100,delayMs) : /archive|commoncrawl/.test(host) ? Math.max(1100,delayMs) : delayMs));
    });
    gates.set(host,start);await start;
  }
  async function attempt(value,{method = 'GET',json = false} = {}) {
    if (!['GET','HEAD'].includes(method)) throw new Error('Public ATS transport permits GET and HEAD only.');
    const url = assertApiUrl(value), host = url.hostname;
    return scheduler.run(host,async () => {
      signal?.throwIfAborted();
      await reserveStart(host);
      signal?.throwIfAborted();
      const controller = new AbortController();
      const callerAborted = () => controller.abort(signal.reason);
      signal?.addEventListener('abort',callerAborted,{once:true});
      let timer;
      const timeout = new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(new AccessError(`${host}: API request timed out (${timeoutMs} ms).`));},timeoutMs);});
      let response;
      try {
        return await Promise.race([(async () => {
          const prior = method === 'GET' ? responseCache.get(url.toString()) : null;
          metrics.requests++;
          response = await fetchImpl(url.toString(),{method,headers:{...(prior?.etag ? {'If-None-Match':prior.etag} : prior?.modified ? {'If-Modified-Since':prior.modified} : {}),Accept:json ? 'application/json' : 'text/plain,application/json','User-Agent':'jobs-finder-cli/2.0 (public posting APIs and URL indexes)'},signal:controller.signal,redirect:'error'});
          if (response.status === 304 && prior) {metrics.notModified++;await response.body?.cancel?.();return json ? JSON.parse(prior.body) : prior.body;}
          if (!response.ok) {
            const error = new AccessError(`${host}: HTTP ${response.status}${response.status === 429 ? ' (rate limited)' : [401,403].includes(response.status) ? ' (access restricted)' : ''}.`,response.status);
            error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'),now());
            if (response.status === 429 || error.retryAfter) {
              const until = Math.min(8.64e15,now() + Math.max(1000,error.retryAfter));
              cooldown.set(host,Math.max(until,cooldown.get(host) || 0));error.retryAt = new Date(until).toISOString();
            }
            throw error;
          }
          if (method === 'HEAD') return {status:response.status,headers:response.headers};
          if (Number(response.headers?.get?.('content-length')) > maxBytes) throw new AccessError(`${host}: response exceeds the safe size limit.`);
          let body;
          if (response.body?.getReader) {
            const reader = response.body.getReader(),chunks = [];let bytes = 0;
            try {
              while (true) {
                const part = await reader.read(); if (part.done) break;
                bytes += part.value.byteLength;metrics.bytes += part.value.byteLength;
                if (bytes > maxBytes) throw new AccessError(`${host}: response exceeds the safe size limit.`);
                chunks.push(part.value);
              }
              body = Buffer.concat(chunks).toString('utf8');
            } finally {await reader.cancel().catch(() => {});reader.releaseLock();}
          } else {
            body = await response.text();metrics.bytes += Buffer.byteLength(body);
            if (Buffer.byteLength(body) > maxBytes) throw new AccessError(`${host}: response exceeds the safe size limit.`);
          }
          const etag=response.headers?.get?.('etag'),modified=response.headers?.get?.('last-modified');
          if (method === 'GET' && (etag || modified) && Buffer.byteLength(body) <= 2*1024*1024) {responseCache.delete(url.toString());responseCache.set(url.toString(),{body,etag,modified});if(responseCache.size>8)responseCache.delete(responseCache.keys().next().value);}
          if (!json) return body;
          try {return JSON.parse(body);} catch {throw new AccessError(`${host}: invalid JSON response.`);}
        })(),timeout]);
      } catch (error) {
        controller.abort();await response?.body?.cancel?.().catch(() => {});
        if (signal?.aborted) throw signal.reason;
        throw error instanceof AccessError ? error : Object.assign(new AccessError(`${host}: network request failed: ${error.message}`),{transient:true});
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',callerAborted);}
    });
  }
  async function request(value,options) {
    for (let retry = 0; retry <= retries; retry++) {
      try {return await attempt(value,options);}
      catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        const transient = error.transient || /timed out/.test(error.message) || [429,500,502,503,504].includes(error.status);
        const wait = Math.max(error.retryAfter || 0,1000 * 2 ** retry + Math.floor(random() * 250));
        if (!transient || retry === retries || wait > 30000) throw error;
        await sleep(wait);
      }
    }
  }
  let lists;
  const publicLists = () => lists ||= Promise.allSettled(PUBLIC_JOB_LISTS.map(async url => ({url,body:await request(url)}))).then(results => ({documents:results.filter(r=>r.status==='fulfilled').map(r=>r.value),errors:results.filter(r=>r.status==='rejected').map(r=>r.reason)}));
  return {metrics,publicLists,request,text:(url,options) => request(url,options),json:(url,options) => request(url,{...options,json:true}),head:url => request(url,{method:'HEAD'})};
}
