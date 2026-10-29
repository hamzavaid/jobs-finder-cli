import {normalizeJob} from './schema.js';
import {readFile, writeFile, mkdir, rename, open, rm} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
export const defaultDbPath = () => resolve(process.env.JOBS_DB || process.env.LJOBS_DB || join(homedir(), '.jobs-cli', 'jobs.json'));
const writes = new Map();
export async function loadDb(path = defaultDbPath()) {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (!data || data.version !== 1 || !data.jobs || typeof data.jobs !== 'object' || Array.isArray(data.jobs) ||
      Object.values(data.jobs).some(j => !j || typeof j !== 'object' || Array.isArray(j) || typeof j.id !== 'string' || !j.id)) {
      throw new Error(`Unsupported or corrupt store format at ${path}`);
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {version:1, updatedAt:null, jobs:{}};
    throw new Error(`Cannot read job store ${path}: ${error.message}`, {cause:error});
  }
}
async function persist(jobs, path) {
  await mkdir(dirname(path), {recursive:true});
  const lockPath = path + '.lock';
  let lock;
  try {lock = await open(lockPath, 'wx', 0o600);}
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Job store is locked: ${lockPath}. Another writer may be active; remove a stale lock only after confirming no writer is running.`);
    throw error;
  }
  const tmpPath = path + `.tmp-${randomUUID()}`;
  try {
    const db = await loadDb(path), now = new Date().toISOString();
    db.jobs = Object.assign(Object.create(null), db.jobs);
    let saved = 0;
    for (const job of jobs) {
      if (!job || typeof job.id !== 'string' || !job.id) continue;
      const source = job.source || 'LinkedIn', key = `${source}:${job.id}`;
      const previous = db.jobs[key] || (source === 'LinkedIn' ? db.jobs[job.id] : null) || {};
      db.jobs[key] = {...previous, ...job, source, savedAt:now};
      if (source === 'LinkedIn') delete db.jobs[job.id];
      saved++;
    }
    db.updatedAt = now;
    await writeFile(tmpPath, JSON.stringify(db, null, 2) + '\n', {encoding:'utf8', flag:'wx', mode:0o600});
    await rename(tmpPath, path);
    return {saved, total:Object.keys(db.jobs).length, path};
  } finally {
    try {await rm(tmpPath, {force:true});}
    finally {await lock.close(); await rm(lockPath, {force:true});}
  }
}
export function saveJobs(jobs, path = defaultDbPath()) {
  path = resolve(path);
  const previous = writes.get(path) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => persist(jobs, path));
  writes.set(path, current);
  current.finally(() => {if (writes.get(path) === current) writes.delete(path);}).catch(() => {});
  return current;
}
export async function savedJobs(path = defaultDbPath()) {
  return Object.values((await loadDb(path)).jobs).map(j => normalizeJob({...j, source:j.source || 'LinkedIn'}));
}
export async function statsForSaved(path = defaultDbPath(), websites = null) {
  const all = await savedJobs(path);
  const jobs = websites ? all.filter(job => websites.includes(job.source)) : all;
  const count = key => {
    const counts = new Map();
    for (const job of jobs) {const value = job[key] || 'unknown'; counts.set(value, (counts.get(value) || 0) + 1);}
    return Object.fromEntries([...counts].sort((a,b) => b[1] - a[1]));
  };
  return {total:jobs.length, byWebsite:count('source'), byCompany:count('company'), byEmployment:count('employmentType'), byLocation:count('location')};
}
