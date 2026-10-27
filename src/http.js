import {setTimeout as sleepDelay} from 'node:timers/promises';
/** Serialized, bounded public-page HTTP client. Never retries restricted access. */
export class AccessError extends Error {
  constructor(message, status = 0) {super(message); this.name = 'AccessError'; this.status = status;}
}
export function assertPublicHtml(body) {
  if (/<title[^>]*>\s*(?:just a moment|access denied|sign in|log in)|<[^>]+(?:id|class)=["'][^"']*(?:captcha-container|cf-challenge)|security (?:check|verification)|unusual (?:activity|traffic)|bot-detection-anonymous|verify (?:you are|you're) human|captcha\s*(?:required|challenge)|<h\d[^>]*>[^<]*captcha/i.test(body)) {
    throw new AccessError('Access challenge or login required. This CLI does not bypass access controls.');
  }
}
export function createHttpClient({delayMs = 1200, timeoutMs = 15000, retries = 2, signal,
  fetchImpl = globalThis.fetch, sleep = ms => sleepDelay(ms,undefined,{signal}), now = Date.now} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error('Invalid HTTP delay, timeout or retry configuration.');
  let nextAllowed = 0, queue = Promise.resolve();
  async function request(url) {
    signal?.throwIfAborted();
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const wait = Math.max(0, nextAllowed - now());
      if (wait) await sleep(wait);
      signal?.throwIfAborted();
      nextAllowed = now() + delayMs;
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
          response = await fetchImpl(url, {
            headers: {'Accept':'text/html,application/xhtml+xml', 'Accept-Language':'en-US,en;q=0.8',
              'User-Agent':'jobs-cli/2.0 (public job listings reader; no browser automation)'},
            signal:controller.signal, redirect:'follow'
          });
          if (response.url && /\/(?:authwall|checkpoint|login|signin|member\/profile\/login)(?:[/?]|$)/i.test(new URL(response.url).pathname)) throw new AccessError(`${host}: login or access checkpoint required.`);
          if ([401,403,429,999].includes(response.status)) throw new AccessError(`${host} returned HTTP ${response.status}; access is restricted. Use the official website.`, response.status);
          if (!response.ok) throw new AccessError(`HTTP ${response.status} from ${host}.`, response.status);
          const body = await response.text();
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
  return {get(url) {
    const result = queue.then(() => request(url));
    queue = result.catch(() => {});
    return result;
  }};
}
