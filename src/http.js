import {RequestScheduler} from './concurrency.js';
import {setTimeout as sleepDelay} from 'node:timers/promises';
/** Per-host serialized, globally bounded public-page HTTP client. */
export class AccessError extends Error {
  constructor(message, status = 0) {super(message); this.name = 'AccessError'; this.status = status;}
}
export function assertPublicHtml(body) {
  if (/<title[^>]*>\s*(?:just a moment|access denied|sign in|log in)|<[^>]+(?:id|class)=["'][^"']*(?:captcha-container|cf-challenge)|security (?:check|verification)|unusual (?:activity|traffic)|bot-detection-anonymous|verify (?:you are|you're) human|captcha\s*(?:required|challenge)|<h\d[^>]*>[^<]*captcha/i.test(body)) {
    throw new AccessError('Access challenge or login required. This CLI does not bypass access controls.');
  }
}
export function createHttpClient({delayMs = 1200, timeoutMs = 15000, retries = 2, signal,maxBytes = 16*1024*1024,scheduler = new RequestScheduler({signal}),
  fetchImpl = globalThis.fetch, sleep = ms => sleepDelay(ms,undefined,{signal}), now = Date.now} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(retries) || retries < 0 || retries > 5 || !Number.isFinite(maxBytes) || maxBytes < 1) throw new Error('Invalid HTTP delay, timeout or retry configuration.');
  const nextAllowed=new Map(),queues=new Map();
  const metrics={requests:0,calls:0,retries:0};
  async function request(url,{onAttempt}={}) {
    signal?.throwIfAborted();
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const wait = Math.max(0, (nextAllowed.get(host)||0) - now());
      if (wait) await sleep(wait);
      signal?.throwIfAborted();
      nextAllowed.set(host,now() + delayMs);
      const controller = new AbortController();
      const callerAborted = () => controller.abort(signal.reason);
      signal?.addEventListener('abort',callerAborted,{once:true});
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AccessError(`Request timed out (${timeoutMs} ms) from ${host}.`));
        }, timeoutMs);
      });
      let response;
      try {
        const operation = (async () => {
          metrics.requests++;if(attempt)metrics.retries++;
          onAttempt?.({retry:attempt>0});
          response = await fetchImpl(url, {
            headers: {'Accept':'text/html,application/xhtml+xml', 'Accept-Language':'en-US,en;q=0.8',
              'User-Agent':'jobs-cli/2.0 (public job listings reader; no browser automation)'},
            signal:controller.signal, redirect:'error'
          });
          if (response.url && /\/(?:authwall|checkpoint|login|signin|member\/profile\/login)(?:[/?]|$)/i.test(new URL(response.url).pathname)) throw new AccessError(`${host}: login or access checkpoint required.`);
          if ([401,403,429,999].includes(response.status)) {
            const error=new AccessError(`${host} returned HTTP ${response.status}; access is restricted. Use the official website.`, response.status);
            const retry=response.headers?.get('retry-after');
            error.retryAt=retry && /^\d+$/.test(retry)?now()+Number(retry)*1000:Date.parse(retry);
            throw error;
          }
          if (!response.ok) throw new AccessError(`HTTP ${response.status} from ${host}.`, response.status);
          let body;
          if (response.body?.getReader) {
            const reader=response.body.getReader(),chunks=[];let size=0;
            try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new AccessError('HTML response exceeds the safe size limit.');chunks.push(part.value);}body=Buffer.concat(chunks).toString('utf8');}
            finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
          } else {body=await response.text();if(Buffer.byteLength(body)>maxBytes)throw new AccessError('HTML response exceeds the safe size limit.');}
          assertPublicHtml(body);
          return body;
        })();
        return await Promise.race([operation, timeout]);
      } catch (error) {
        controller.abort();
        await response?.body?.cancel?.().catch(() => {});
        if (signal?.aborted) throw signal.reason;
        const status = error.status || 0;
        const transient = !(error instanceof AccessError) || /timed out/.test(error.message) || [500,502,503,504].includes(status);
        if (!transient || attempt === retries) throw error instanceof AccessError ? error : new AccessError(`Network request failed from ${host}: ${error.message}`);
      } finally {clearTimeout(timer);signal?.removeEventListener('abort',callerAborted);}
      await sleep(Math.max(delayMs, 1000 * (attempt + 1)));
    }
  }
  return {scheduler,metrics,attemptMetrics:true,get(url,options) {
    metrics.calls++;
    const host=new URL(url).hostname;
    const result = (queues.get(host)||Promise.resolve()).catch(()=>{}).then(() => scheduler.run(host,() => request(url,options)));
    queues.set(host,result);
    result.finally(()=>{if(queues.get(host)===result)queues.delete(host);}).catch(()=>{});
    return result;
  }};
}
