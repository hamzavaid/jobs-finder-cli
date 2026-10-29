import {runCachePerformance} from '../test/helpers/cache-performance-fixture.js';
const result=await runCachePerformance({cliModule:process.env.CACHE_BENCHMARK_CLI});
const summarize=run=>({elapsedMs:Math.round(run.elapsedMs),exitCode:run.status,jobsReturned:run.jobs.length,...run.metrics,diagnostics:run.stderr.split('\n').filter(line=>/Pipeline:|Cache:|Source coverage|Stage time|FIXTURE_METRICS/.test(line))});
console.log(JSON.stringify({fixture:'130 boards / 4160 postings, stale snapshots, incomplete evidence, oversized Greenhouse bulk, archive 503',note:'Mocked network with virtual service delays; real Node process, filesystem and parsing time. No live latency claim.',cold:summarize(result.cold),repeat:summarize(result.warm)},null,2));
if(result.cold.status!==0 || result.warm.status!==0 || !process.env.CACHE_BENCHMARK_CLI && result.warm.metrics.requests!==0)process.exitCode=1;
