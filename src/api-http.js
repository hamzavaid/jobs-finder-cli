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
export function createApiClient({fetchImpl = globalThis.fetch,signal,timeoutMs = 15000,delayMs = 1200,maxBytes = 16 * 1024 * 1024,now = Date.now,sleep = ms => delay(ms,undefined,{signal}),scheduler = new RequestScheduler({signal})} = {}) {
  const next = new Map();
  async function request(value,{method = 'GET',json = false} = {}) {
    const url = assertApiUrl(value), host = url.hostname;
    return scheduler.run(host,async () => {
      signal?.throwIfAborted();
      const slot = Math.max(now(),next.get(host) || 0);
      next.set(host,slot + (/archive|commoncrawl/.test(host) ? Math.max(1100,delayMs) : delayMs));
      if (slot > now()) await sleep(slot - now());
      signal?.throwIfAborted();
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([controller.signal,signal]) : controller.signal;
      let timer;
      const timeout = new Promise((_,reject) => {timer = setTimeout(() => {controller.abort();reject(new AccessError(`${host}: API request timed out (${timeoutMs} ms).`));},timeoutMs);});
      let response;
      try {
        return await Promise.race([(async () => {
          response = await fetchImpl(url.toString(),{method,headers:{Accept:json ? 'application/json' : 'text/plain,application/json','User-Agent':'jobs-finder-cli/2.0 (public posting APIs and URL indexes)'},signal:combined,redirect:'error'});
          if (!response.ok) throw new AccessError(`${host}: HTTP ${response.status}${response.status === 429 ? ' (rate limited)' : [401,403].includes(response.status) ? ' (access restricted)' : ''}.`,response.status);
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
        throw error instanceof AccessError ? error : new AccessError(`${host}: network request failed: ${error.message}`);
      } finally {clearTimeout(timer);}
    });
  }
  return {request,text:(url,options) => request(url,options),json:(url,options) => request(url,{...options,json:true}),head:url => request(url,{method:'HEAD'})};
}
