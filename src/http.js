/** Polite guest-page HTTP client: no login, proxy rotation or anti-bot bypass. */
export class AccessError extends Error {
  constructor(message, status) {super(message); this.name = 'AccessError'; this.status = status;}
}
export function createHttpClient({delayMs = 1200, timeoutMs = 15000, fetchImpl = globalThis.fetch} = {}) {
  let nextAllowed = 0;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  async function get(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = Math.max(0, nextAllowed - Date.now());
      if (wait) await sleep(wait);
      nextAllowed = Date.now() + delayMs;
      let response;
      try {
        response = await fetchImpl(url, {
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.8',
            'User-Agent': 'jobs-cli/2.0 (public job listings reader; no browser automation)'
          },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow'
        });
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new AccessError(`Request timed out (${timeoutMs} ms).`, 0);
        }
        throw new AccessError(`Network request failed: ${err.message}`, 0);
      }
      const host = new URL(url).hostname;
      if ([401, 403, 429, 999].includes(response.status)) {
        throw new AccessError(`${host} returned HTTP ${response.status}; access is restricted. Use the official website.`, response.status);
      }
      if (response.status >= 500 && attempt < 2) {
        await sleep(Math.max(delayMs, 1000 * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new AccessError(`HTTP ${response.status} from ${host}.`, response.status);
      const body = await response.text();
      if (/captcha|security (check|verification)|unusual activity|bot-detection-anonymous|just a moment/i.test(body) && !/base-search-card|data-jk=|mosaic-provider-jobcards/i.test(body)) {
        throw new AccessError('Access challenge encountered. This CLI does not bypass access controls.', response.status);
      }
      return body;
    }
    throw new AccessError('Job site returned repeated server errors.', 503);
  }
  return {get};
}
