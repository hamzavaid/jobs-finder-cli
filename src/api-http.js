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
    'web.archive.org':/^\/cdx\/search\/cdx$/,
    'index.commoncrawl.org':/^\/(?:collinfo\.json|CC-MAIN-\d{4}-\d{2}-index)$/
  };
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !Object.hasOwn(allowed,url.hostname) || !allowed[url.hostname].test(url.pathname) || /%2f|%5c|%00/i.test(url.pathname)) throw new Error('Refusing an untrusted ATS/index request URL.');
  return url;
}
export function retryAfterMs(value,now = Date.now()) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) * 1000;
  return Math.max(0,(Date.parse(value) || now) - now);
}
export function createApiClient({retries = 2,random = Math.random,fetchImpl = globalThis.fetch,signal,timeoutMs = 15000,delayMs = 1200,maxBytes = 16 * 1024 * 1024,now = Date.now,sleep = ms => delay(ms,undefined,{signal}),scheduler = new RequestScheduler({signal})} = {}) {
  if (!Number.isInteger(retries) || retries < 0 || retries > 3 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Invalid API HTTP configuration.');
  const next = new Map(),cooldown = new Map();
  async function attempt(value,{method = 'GET',json = false} = {}) {
    const url = assertApiUrl(value), host = url.hostname;
    return scheduler.run(host,async () => {
      signal?.throwIfAborted();
      const slot = Math.max(now(),next.get(host) || 0,cooldown.get(host) || 0);
      next.set(host,slot + (/archive|commoncrawl/.test(host) ? Math.max(1100,delayMs) : delayMs));
      if (slot - now() > 30000) {const error = new AccessError(`${host}: provider is backed off; retry later.`,429);error.retryAt = new Date(slot).toISOString();throw error;}
      if (slot > now()) await sleep(slot - now());
      signal?.throwIfAborted();
      const controller = new AbortController();
      const callerAborted = () => controller.abort(signal.reason);
      signal?.addEventListener('abort',callerAborted,{once:true});
      let timer;
      const timeout = new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(new AccessError(`${host}: API request timed out (${timeoutMs} ms).`));},timeoutMs);});
      let response;
      try {
        return await Promise.race([(async () => {
          response = await fetchImpl(url.toString(),{method,headers:{Accept:json ? 'application/json' : 'text/plain,application/json','User-Agent':'jobs-finder-cli/2.0 (public posting APIs and URL indexes)'},signal:controller.signal,redirect:'error'});
          if (!response.ok) {
            const error = new AccessError(`${host}: HTTP ${response.status}${response.status === 429 ? ' (rate limited)' : [401,403].includes(response.status) ? ' (access restricted)' : ''}.`,response.status);
            error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'),now());
            if (response.status === 429 || error.retryAfter) {
              const until = now() + Math.max(1000,error.retryAfter);
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
                bytes += part.value.byteLength;
                if (bytes > maxBytes) throw new AccessError(`${host}: response exceeds the safe size limit.`);
                chunks.push(part.value);
              }
              body = Buffer.concat(chunks).toString('utf8');
            } finally {await reader.cancel().catch(() => {});reader.releaseLock();}
          } else {
            body = await response.text();
            if (Buffer.byteLength(body) > maxBytes) throw new AccessError(`${host}: response exceeds the safe size limit.`);
          }
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
  return {request,text:(url,options) => request(url,options),json:(url,options) => request(url,{...options,json:true}),head:url => request(url,{method:'HEAD'})};
}
