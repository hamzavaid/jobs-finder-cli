import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {homedir} from 'node:os';
export const defaultDbPath = () => resolve(process.env.JOBS_DB || process.env.LJOBS_DB || join(homedir(), '.jobs-cli', 'jobs.json'));
export async function loadDb(path = defaultDbPath()) {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.version !== 1 || !data.jobs || typeof data.jobs !== 'object' || Array.isArray(data.jobs)) {
      throw new Error(`Unsupported store format at ${path}`);
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {version: 1, updatedAt: null, jobs:{}};
    throw error;
  }
}
export async function saveJobs(jobs, path = defaultDbPath()) {
  const db = await loadDb(path);
  const now = new Date().toISOString();
  for (const job of jobs) {
    if (!job.id) continue;
    const key = `${job.source || 'LinkedIn'}:${job.id}`;
    db.jobs[key] = {...(db.jobs[key] || {}), ...job, savedAt: now};
    // Clean up old unprefixed LinkedIn IDs when migrating v1 saved data.
    if (job.source === 'LinkedIn' && db.jobs[job.id]) delete db.jobs[job.id];
  }
  db.updatedAt = now;
  await mkdir(dirname(path), {recursive:true});
  const tmpPath = path + `.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(db, null, 2) + '\n', 'utf8');
  await rename(tmpPath, path);
  return {saved: jobs.length, total: Object.keys(db.jobs).length, path};
}
export async function savedJobs(path = defaultDbPath()) {
  const db = await loadDb(path);
  return Object.values(db.jobs);
}
export async function statsForSaved(path = defaultDbPath()) {
  const jobs = await savedJobs(path);
  const count = (key) => Object.fromEntries([...new Set(jobs.map(j => j[key] || 'unknown'))]
    .map(value => [value, jobs.filter(j => (j[key] || 'unknown') === value).length])
    .sort((a,b) => b[1] - a[1]));
  return {total: jobs.length, byWebsite: count('source'), byCompany: count('company'), byEmployment: count('employmentType'), byLocation: count('location')};
}
