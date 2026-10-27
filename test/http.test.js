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

test('transient retries are bounded and timeout retries release the queue', async () => {
  for (const failure of ['network','timeout','server']) {
    let calls = 0;
    const http = createHttpClient({delayMs:0,timeoutMs:5,sleep:async () => {},fetchImpl:async () => {
      calls++;
      if (failure === 'network') throw new TypeError('offline');
      if (failure === 'timeout') return new Promise(() => {});
      return {ok:false,status:502};
    }});
    await assert.rejects(http.get('https://example.com'));
    assert.equal(calls,3,failure);
  }
});

test('404 and challenge responses are never retried; one failure does not poison client queue', async () => {
  let calls = 0;
  const http = createHttpClient({delayMs:0,fetchImpl:async () => ++calls === 1 ? {ok:false,status:404} : {ok:true,status:200,text:async () => 'ok'}});
  await assert.rejects(http.get('https://example.com/404'),/HTTP 404/);
  assert.equal(calls,1); assert.equal(await http.get('https://example.com/ok'),'ok');
});
