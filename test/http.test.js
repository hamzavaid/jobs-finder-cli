import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpClient, AccessError} from '../src/http.js';

test('fetches HTML using the public guest client', async () => {
  const seen = [];
  const http = createHttpClient({delayMs: 0, fetchImpl: async (url, init) => {
    seen.push({url, init});
    return {status: 200, ok: true, text:async()=>'<ul></ul>'};
  }});
  assert.equal(await http.get('https://www.linkedin.com/jobs-guest/foo'), '<ul></ul>');
  assert.equal(seen.length, 1);
  assert.match(seen[0].init.headers['User-Agent'], /jobs-cli/);
});
test('rate limit is not circumvented or retried', async () => {
  let calls = 0;
  const http = createHttpClient({delayMs: 0, fetchImpl: async () => {
    calls++;
    return {status:429, ok:false};
  }});
  await assert.rejects(http.get('https://www.linkedin.com/jobs-guest/test'), AccessError);
  assert.equal(calls, 1);
});
test('detects and stops access challenges', async () => {
  const http = createHttpClient({delayMs:0, fetchImpl: async()=>({status:200, ok:true, text:async()=>'<h1>Security verification required: CAPTCHA</h1>'})});
  await assert.rejects(http.get('https://www.linkedin.com/jobs-guest/test'), /Access challenge/);
});
