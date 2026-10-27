import {Command} from 'commander';
import {normalizeOptions, normalizeCompany, validateOutputOptions, normalizeWebsites} from './filters.js';
import {createHttpClient} from './http.js';
import {findJobs} from './search.js';
import {providers, fetchProviderJob} from './providers.js';
import {assertSearchPage} from './provider-search.js';
import {serializeJobs, emit} from './output.js';
import {savedJobs, saveJobs, statsForSaved, defaultDbPath} from './store.js';

function addFilters(command) {
  return command
    .option('--website <sites...>', 'LinkedIn Indeed Glassdoor (one or more; default: all three)', (values, prev) => [...prev, ...(Array.isArray(values) ? values : [values])], [])
    .option('--search <keywords>', 'Free-form job keywords (ANY occupation, e.g. chef, accountant)')
    .option('--date <duration>', 'Posted within Nh/Nd/Nw, e.g. 1d = past 24 hours')
    .option('--company <name>', 'Company name (client-side exact-normalized match)')
    .option('--remote <boolean>', 'true: remote; false: onsite or hybrid')
    .option('--workplace <type>', 'remote | hybrid | onsite (instead of --remote)')
    .option('--experience <level>', 'internship | entry | associate | senior | director | executive')
    .option('--employment <type>', 'full-time | part-time | contract | temporary | internship | volunteer | other')
    .option('--under <boolean>', 'Under 10 applicants; unknown counts are excluded except unconfirmed LinkedIn true facet')
    .option('--verified <boolean>', 'Job verification; unknown values require a supported facet or are excluded')
    .option('--location <place>', 'City, region, or country, e.g. "Los Angeles"');
}
function addOutputOptions(command) {
  return command
    .option('--format <format>', 'table | json | jsonl | csv', 'table')
    .option('-o, --output <file>', 'Write results to a file instead of stdout');
}
function eprint(message) {process.stderr.write(message + '\n');}
function createClient(options) {return createHttpClient({delayMs: Number(options.delay ?? 1200)});}
function filterSaved(jobs, options) {
  let rows = jobs;
  if (options.company) rows = rows.filter(j => normalizeCompany(j.company) === normalizeCompany(options.company));
  if (options.search) {
    const q = String(options.search).toLowerCase();
    rows = rows.filter(j => [j.title, j.company, j.description, j.location].some(t => String(t || '').toLowerCase().includes(q)));
  }
  if (options.website?.length) {const sites = normalizeWebsites(options.website); rows = rows.filter(j => sites.includes(j.source || 'LinkedIn'));}
  if (options.limit) rows = rows.slice(0, Number(options.limit));
  return rows;
}

export async function runCli(argv = process.argv) {
  const program = new Command();
  program.name('jobs')
    .description('Search job listings on LinkedIn, Indeed and Glassdoor across all occupations.')
    .version('2.0.0')
    .showHelpAfterError('(run jobs --help for commands)');

  addOutputOptions(addFilters(program.command('find')
    .description('Find jobs on LinkedIn, Indeed and/or Glassdoor with source-aware filtering')
    .option('--limit <number>', 'Maximum accepted jobs, 1–200', '25')
    .option('--pages <number>', 'Maximum guest-search pages to scan, 1–20', '5')
    .option('--delay <ms>', 'Minimum delay between requests (750–30000 ms)', '1200')
    .option('--sort <order>', 'recent | relevant', 'recent')
    .option('--details', 'Fetch each candidate job detail (extra requests)')
    .option('--strict', 'Exclude rows whose requested filters cannot be independently verified')
    .option('--save', 'Upsert results into local JSON store')))
    .action(async raw => {
      const options = normalizeOptions(raw);
      const http = createClient(options);
      const {jobs, stats} = await findJobs(options, http);
      if (options.save) {
        const result = await saveJobs(jobs);
        eprint(`Saved ${result.saved} jobs locally (${result.total} total) to ${result.path}`);
      }
      const content = serializeJobs(jobs, options.format);
      await emit(content, options.output);
      if (options.output) eprint(`Wrote ${jobs.length} jobs to ${options.output}`);
      eprint(`Scanned ${stats.cardsSeen} cards across ${stats.pages} page(s) on ${options.websites.join(', ')}; ${jobs.length} accepted, ${stats.rejected} excluded.`);
      for (const issue of stats.errors) eprint(`WARNING: ${issue}`);
      if (stats.facetReliant.length) {
        eprint(`CAUTION: Could not independently confirm some server-applied facets: ${stats.facetReliant.join(', ')}. Use --strict to exclude uncertain matches.`);
      }
      if (options.under === false || options.verified === false) {
        eprint('NOTE: False values for --under/--verified need explicit public evidence; unknown is excluded, not assumed false.');
      }
      if (!jobs.length) eprint('No matches. The search may be too narrow, a site may have blocked access, or the public markup may not expose enough information.');
    });

  addOutputOptions(program.command('job')
    .description('Retrieve a LinkedIn, Indeed or Glassdoor job by ID or posting URL')
    .argument('<id-or-url>', 'LinkedIn/Glassdoor numeric ID, Indeed key, or posting URL')
    .option('--website <site>', 'LinkedIn | Indeed | Glassdoor; autodetected from URLs')
    .option('--delay <ms>', 'Minimum request delay (ms)', '1200')
    .option('--save', 'Save job to local store'))
    .action(async (input, options) => {
      validateOutputOptions(options);
      const job = await fetchProviderJob(input, options.website, createClient(options));
      if (!job.title) eprint('WARNING: The guest detail did not expose a job title.');
      if (options.save) await saveJobs([job]);
      await emit(serializeJobs([job], options.format), options.output);
    });

  addOutputOptions(program.command('saved')
    .description('Show locally saved job results without making any web requests')
    .option('--search <text>', 'Search title/company/description/location')
    .option('--company <name>', 'Restrict to company')
    .option('--website <sites...>', 'Filter saved sources: LinkedIn Indeed Glassdoor', (values, prev) => [...prev, ...(Array.isArray(values) ? values : [values])], [])
    .option('--limit <number>', 'Maximum output rows'))
    .action(async options => {
      validateOutputOptions(options);
      const jobs = filterSaved(await savedJobs(), options);
      await emit(serializeJobs(jobs, options.format), options.output);
    });

  program.command('export')
    .description('Export all or filtered locally saved jobs (no network)')
    .requiredOption('-o, --output <file>', 'Export file path')
    .option('--format <format>', 'json | jsonl | csv', 'csv')
    .option('--search <text>', 'Search title/company/description/location')
    .option('--company <name>', 'Restrict to company')
    .option('--website <sites...>', 'Filter saved sources: LinkedIn Indeed Glassdoor', (values, prev) => [...prev, ...(Array.isArray(values) ? values : [values])], [])
    .action(async options => {
      if (!['json', 'jsonl', 'csv'].includes(options.format)) throw new Error('Export format must be json, jsonl, or csv.');
      const jobs = filterSaved(await savedJobs(), options);
      await emit(serializeJobs(jobs, options.format), options.output);
      eprint(`Exported ${jobs.length} saved job(s) to ${options.output}`);
    });

  program.command('stats').description('Summarize locally saved job counts (no network)')
    .option('--website <sites...>', 'Filter saved sources', (values, prev) => [...prev, ...(Array.isArray(values) ? values : [values])], [])
    .action(async options => {
    const stats = await statsForSaved(undefined, options.website.length ? normalizeWebsites(options.website) : null);
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  });

  addFilters(program.command('url')
    .description('Print LinkedIn, Indeed and/or Glassdoor search URLs (no web request)'))
    .action(raw => {
      const opts = normalizeOptions({...raw, limit: 1, pages: 1});
      for (const site of opts.websites) process.stdout.write(providers[site].searchUrl(opts, 0) + '\n');
    });

  program.command('doctor')
    .description('Display runtime/store info; optionally probe selected public search pages')
    .option('--probe', 'Request one search page per selected provider (plus Glassdoor robots.txt)')
    .option('--search <keywords>', 'Keywords for --probe', 'chef')
    .option('--website <sites...>', 'LinkedIn Indeed Glassdoor; default: all three', (values, prev) => [...prev, ...(Array.isArray(values) ? values : [values])], [])
    .action(async options => {
      const sites = normalizeWebsites(options.website);
      const info = {node:process.version, database:defaultDbPath(), saved:(await savedJobs()).length, websites:sites, onlineProbe:'skipped'};
      if (options.probe) {
        const opt = normalizeOptions({search:options.search,website:sites,limit:1,pages:1});
        const http = createHttpClient({retries:0});
        info.onlineProbe = {};
        for (const site of sites) {
          const provider = providers[site];
          try {
            const client = provider.prepareHttp ? await provider.prepareHttp(http) : http;
            const html = await client.get(provider.searchUrl(opt));
            const cards = provider.parseCards(html);
            assertSearchPage(html,cards,provider.emptyPattern,site);
            info.onlineProbe[site] = {status:'ok',cards:cards.length};
          } catch (error) {
            info.onlineProbe[site] = {status:'error',error:error.message};
            process.exitCode = 1;
          }
        }
      }
      process.stdout.write(JSON.stringify(info,null,2) + '\n');
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    eprint(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
