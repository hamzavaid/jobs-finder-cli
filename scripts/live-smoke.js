/** Explicitly optional, low-volume live checks. Never imported by offline tests. */
import {normalizeOptions} from '../src/filters.js';
import {providers} from '../src/providers.js';
import {searchProvider} from '../src/provider-search.js';
import {createHttpClient} from '../src/http.js';
import {CollectionManager} from '../src/collection.js';
import {createApiClient} from '../src/api-http.js';
import {failureStatus} from '../src/provider-access.js';

const options = normalizeOptions({search:process.env.JOBS_SMOKE_SEARCH || 'accountant',
  website:process.argv.slice(2),pages:1,limit:3});
const http = createHttpClient({delayMs:1200,timeoutMs:15000,retries:0});
const collection = new CollectionManager({http:createApiClient({timeoutMs:10000,retries:0}),maxBoards:3,discoveryOptions:{maxPages:1,maxValidations:3}});
for (const site of options.websites) {
  try {
    const result = ['ats','feed'].includes(providers[site].kind) ? await collection.find(providers[site],options) : await searchProvider(providers[site],options,http);
    const valid = result.jobs.every(job => job.source === site && job.id && job.title && job.company && job.url);
    if (!valid) throw new Error('Invalid normalized posting schema.');
    console.log(JSON.stringify({provider:site,status:result.stats.status || (result.jobs.length ? 'parsed' : 'explicit-no-results'),jobs:result.jobs.length,cards:result.stats.cardsSeen,pages:result.stats.pages,partial:result.stats.complete === false,warnings:result.stats.errors?.slice(0,3)}));
    // A valid empty page demonstrates no live extraction; signal inconclusive failure.
    if (!result.jobs.length) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({provider:site,status:failureStatus(error),error:error.message,httpStatus:error.status || null,requests:error.searchStats?.httpRequests??0,pagesParsed:error.searchStats?.pages??0}));
    process.exitCode = 1;
  }
}
