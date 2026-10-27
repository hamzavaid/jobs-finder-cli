/** Explicitly optional, low-volume live checks. Never imported by offline tests. */
import {normalizeOptions} from '../src/filters.js';
import {providers} from '../src/providers.js';
import {searchProvider} from '../src/provider-search.js';
import {createHttpClient} from '../src/http.js';

const options = normalizeOptions({search:process.env.JOBS_SMOKE_SEARCH || 'accountant',
  website:process.argv.slice(2),pages:1,limit:3});
const http = createHttpClient({delayMs:1200,timeoutMs:15000,retries:0});
for (const site of options.websites) {
  try {
    const result = await searchProvider(providers[site],options,http);
    const valid = result.jobs.every(job => job.source === site && job.id && job.title && job.company && job.url);
    if (!valid) throw new Error('Invalid normalized posting schema.');
    console.log(JSON.stringify({provider:site,status:result.jobs.length ? 'parsed' : 'explicit-no-results',jobs:result.jobs.length,pages:result.stats.pages}));
    // A valid empty page demonstrates no live extraction; signal inconclusive failure.
    if (!result.jobs.length) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({provider:site,status:'error',error:error.message,httpStatus:error.status || null}));
    process.exitCode = 1;
  }
}
