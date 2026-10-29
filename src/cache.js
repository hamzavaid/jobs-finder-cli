import {readFile,writeFile,mkdir,open,rename,rm,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {validBoardId,publicLink} from './ats/shared.js';

const DAY = 86400000, kinds = new Set(['inventory','postings','search','resolution','manifest','maintenance']);
export const CACHE_TTL = Object.freeze({postings:20 * 60000,search:10 * 60000,stale:7 * DAY,partialSearch:3 * 60000,prune:DAY,enrichmentTransient:5 * 60000,enrichmentStructural:DAY});
export function defaultCacheDir(env = process.env,platform = process.platform,home = homedir()) {
  if (env.JOBS_CACHE_DIR) return env.JOBS_CACHE_DIR;
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home,'AppData','Local'),'jobs-finder-cli','Cache');
  if (platform === 'darwin') return join(home,'Library','Caches','jobs-finder-cli');
  return join(env.XDG_CACHE_HOME || join(home,'.cache'),'jobs-finder-cli');
}
export function stableKey(value) {
  function ordered(item) {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key,ordered(item[key])]));
    return item;
  }
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
const validJobs = jobs => Array.isArray(jobs) && jobs.length <= 50000 && jobs.every(job => job && ['Greenhouse','Lever','Ashby','SmartRecruiters','Personio','Remotive','Himalayas','GitHub'].includes(job.source) && typeof job.id === 'string' && typeof job.title === 'string' && !!publicLink(job.url));
export function validCacheRecord(record,kind,key) {
  if (!record || record.version !== 1 || record.kind !== kind || record.key !== key || !Number.isFinite(Date.parse(record.updatedAt)) || (record.expiresAt !== null && !Number.isFinite(Date.parse(record.expiresAt)))) return false;
  const data = record.data;
  if (!data || typeof data !== 'object') return false;
  if (kind !== 'inventory' && record.expiresAt === null) return false;
  if (kind === 'maintenance') return Number.isFinite(Date.parse(data.lastPrunedAt));
  if (kind === 'manifest') return typeof data.revision === 'string' && typeof data.pending === 'boolean';
  if (kind === 'resolution') return ['complete','incomplete','blocked','unsupported','failed'].includes(data.status) && (data.job === null || data.job && typeof data.job.title === 'string' && !!publicLink(data.job.url));
  if (kind === 'inventory') return typeof data.provider === 'string' && data.cursors && typeof data.cursors === 'object' && !Array.isArray(data.cursors) && Array.isArray(data.boards) && data.boards.length <= 50000 && data.boards.every(board => board && validBoardId(board.id) && ['global','eu'].includes(board.region || 'global') && ['pending','valid','invalid'].includes(board.status));
  if (kind === 'postings') return validJobs(data.jobs) && typeof data.complete === 'boolean' && typeof data.revision === 'string' && validBoardId(data.board?.id);
  return validJobs(data.jobs) && Array.isArray(data.refs) && data.refs.every(ref => ref && typeof ref.key === 'string' && typeof ref.revision === 'string') && typeof data.inventoryFingerprint === 'string' && data.stats && Array.isArray(data.stats.errors);
}
export class CacheManager {
  constructor({root = defaultCacheDir(),now = Date.now,signal,lockTimeoutMs = 2000,onWarning = () => {}} = {}) {
    Object.assign(this,{root,now,signal,lockTimeoutMs,onWarning});
    this.pending = new Map();
    this.metrics = {readMs:0,writeMs:0,postingReads:0,manifestChecks:0,pruneRuns:0};
  }
  path(kind,key) {
    if (!kinds.has(kind) || typeof key !== 'string') throw new Error('Invalid internal cache key.');
    return join(this.root,kind,stableKey(key) + '.json');
  }
  fresh(record) {return !!record && (record.expiresAt === null || Date.parse(record.expiresAt) > this.now());}
  usableStale(record) {const age=this.now()-Date.parse(record?.data?.lastSuccessfulFetchAt || record?.updatedAt);return !!record && age>=0 && age<=CACHE_TTL.stale;}
  async rawRead(kind,key) {
    if (kind === 'postings') this.metrics.postingReads++;
    const path = this.path(kind,key);
    try {
      const handle=await open(path,'r');let info,record;
      try {info=await handle.stat();if(info.size>64*1024*1024)throw new Error('Oversized cache file.');record=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
      if (!validCacheRecord(record,kind,key)) throw new Error('Invalid cache schema.');
      Object.defineProperty(record,'fileStamp',{value:fileStamp(info),enumerable:false});
      return record;
    } catch (error) {if (error.code === 'ENOENT') return null; throw error;}
  }
  async read(kind,key) {
    const started=performance.now();
    try {return await this.readRecord(kind,key);} finally {this.metrics.readMs += performance.now()-started;}
  }
  async readRecord(kind,key) {
    try {
      const record = await this.rawRead(kind,key);
      if (record && kind === 'postings') {
        const manifest = await this.rawRead('manifest',key).catch(() => null);
        if (manifest && !manifest.data.pending && sameStamp(manifest.data.snapshotStamp,record.fileStamp) && manifest.data.revision === record.data.revision && validManifestTimes(manifest,this.now())) {
          record.expiresAt = manifest.expiresAt;record.updatedAt = manifest.updatedAt;
          record.data.lastSuccessfulFetchAt = manifest.data.lastSuccessfulFetchAt || record.data.lastSuccessfulFetchAt;
          if (manifest.data.observedAt) record.data.jobs = record.data.jobs.map(job => ({...job,lastSeenAt:manifest.data.observedAt,lastObservedAt:manifest.data.observedAt}));
        }
      }
      return record;
    }
    catch (error) {
      if (['EACCES','EPERM','ENOTDIR'].includes(error.code)) {this.onWarning('Cache is unavailable; collecting without persisted cache data.');return null;}
      if (error.code && !['ENOENT'].includes(error.code)) throw error;
      return this.withLock(kind,key,async () => {
        try {return await this.rawRead(kind,key);}
        catch {
          await rename(this.path(kind,key),this.path(kind,key) + `.corrupt-${randomUUID()}`).catch(error => {if (error.code !== 'ENOENT') throw error;});
          this.onWarning(`Recovered corrupt ${kind} cache; refreshing automatically.`);
          return null;
        }
      });
    }
  }
  async withLock(kind,key,work) {
    const path = this.path(kind,key), directory = join(this.root,kind);
    await mkdir(directory,{recursive:true});
    const lockPath = path + '.lock', started = Date.now();
    let handle;
    while (!handle) {
      this.signal?.throwIfAborted();
      try {
        handle = await open(lockPath,'wx',0o600);
        await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date(this.now()).toISOString()}));
      } catch (error) {
        if (handle) {await handle.close(); await rm(lockPath,{force:true}); throw error;}
        if (error.code !== 'EEXIST') throw error;
        await this.recoverLock(lockPath);
        if (Date.now() - started >= this.lockTimeoutMs) throw new Error('ATS cache is busy in another process; retry this search shortly.');
        await sleep(25,undefined,{signal:this.signal});
      }
    }
    try {return await work();}
    finally {await handle.close(); await rm(lockPath,{force:true});}
  }
  async recoverLock(lockPath) {
    const info = await stat(lockPath).catch(() => null);
    if (!info || this.now() - info.mtimeMs <= 300000) return;
    // Only one process may inspect/remove a dead owner's lock at a time.
    let guard;
    try {guard = await open(lockPath + '.recovery','wx',0o600);await guard.writeFile(JSON.stringify({pid:process.pid}));}
    catch (error) {
      if (guard) {await guard.close();await rm(lockPath + '.recovery',{force:true});throw error;}
      if (error.code !== 'EEXIST') throw error;
      const stale = await stat(lockPath + '.recovery').catch(() => null);
      if (stale && this.now() - stale.mtimeMs > 300000) {
        let alive = true;
        try {const owner = JSON.parse(await readFile(lockPath + '.recovery','utf8'));process.kill(owner.pid,0);}
        catch (failure) {if (failure.code === 'ESRCH' || failure instanceof SyntaxError) alive = false;}
        if (!alive) await rm(lockPath + '.recovery',{force:true});
      }
      return;
    }
    try {
      const current = await stat(lockPath).catch(() => null);
      if (!current || this.now() - current.mtimeMs <= 300000) return;
      let alive = true;
      try {const owner = JSON.parse(await readFile(lockPath,'utf8')); if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new SyntaxError('Invalid lock owner'); process.kill(owner.pid,0);}
      catch (error) {if (error.code === 'ESRCH' || error instanceof SyntaxError) alive = false;}
      if (!alive) await rm(lockPath,{force:true});
    } finally {await guard.close(); await rm(lockPath + '.recovery',{force:true});}
  }
  update(kind,key,mutate,{ttl = null} = {}) {
    const queueKey = `${kind}:${key}`, previous = this.pending.get(queueKey) || Promise.resolve();
    const started=performance.now();
    const result = previous.catch(() => {}).then(() => this.withLock(kind,key,async () => {
      let current;
      try {current = await this.rawRead(kind,key);}
      catch {
        await rename(this.path(kind,key),this.path(kind,key) + `.corrupt-${randomUUID()}`).catch(error => {if (error.code !== 'ENOENT') throw error;});
        this.onWarning(`Recovered corrupt ${kind} cache.`);
      }
      this.signal?.throwIfAborted();
      const stamp = this.now(), data = await mutate(current?.data);
      const record = {version:1,kind,key,updatedAt:new Date(stamp).toISOString(),expiresAt:ttl === null ? null : new Date(stamp + ttl).toISOString(),data};
      if (!validCacheRecord(record,kind,key)) throw new Error(`Refusing to write invalid ${kind} cache.`);
      const encoded = JSON.stringify(record);
      if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('Cache record exceeds the safe file size limit.');
      const temporary = this.path(kind,key) + `.tmp-${randomUUID()}`;
      try {
        // Once replacement begins it finishes even if cancellation arrives; readers
        // observe the old record or the new complete record, never a partial write.
        await writeFile(temporary,encoded,{encoding:'utf8',flag:'wx',mode:0o600});
        await rename(temporary,this.path(kind,key));
      } finally {await rm(temporary,{force:true});}
      return record;
    }));
    this.pending.set(queueKey,result);
    result.finally(() => {this.metrics.writeMs += performance.now()-started;if (this.pending.get(queueKey) === result) this.pending.delete(queueKey);}).catch(() => {});
    return result;
  }
  async put(kind,key,data,options = {}) {
    if (kind !== 'postings') return this.update(kind,key,() => data,options);
    return this.withLock('postings',key+':commit',async () => {
      const previous = await this.read(kind,key);
      const manifest = {revision:data.revision,pending:true,parserVersion:data.parserVersion,lastSuccessfulFetchAt:data.lastSuccessfulFetchAt,observedAt:data.complete ? data.lastSuccessfulFetchAt : null};
      await this.update('manifest',key,() => manifest,options);
      const unchanged = previous?.data.revision === data.revision && previous.data.parserVersion === data.parserVersion && previous.data.complete === data.complete && previous.data.content === data.content && previous.data.pages === data.pages && stableKey(previous.data.enrichment || {}) === stableKey(data.enrichment || {});
      const record = unchanged ? {...previous,data,updatedAt:new Date(this.now()).toISOString(),expiresAt:new Date(this.now()+(options.ttl ?? CACHE_TTL.postings)).toISOString()} : await this.update(kind,key,() => data,options);
      const snapshotStamp=fileStamp(await stat(this.path(kind,key)));
      await this.update('manifest',key,() => ({...manifest,pending:false,snapshotStamp}),options);
      return record;
    });
  }
  async postingManifest(key) {
    this.metrics.manifestChecks++;
    const manifest = await this.read('manifest',key);
    if (manifest?.data.pending) return null;
    const info=await stat(this.path('postings',key)).catch(error => {if(error.code==='ENOENT')return null;throw error;});
    if (!info) return null;
    if (manifest?.data.snapshotStamp) return sameStamp(manifest.data.snapshotStamp,fileStamp(info)) && validManifestTimes(manifest,this.now()) ? manifest : null;
    // Legacy manifests have no file identity. Validate the shard once, then upgrade
    // conservatively from the snapshot rather than extending its source timestamps.
    return this.withLock('postings',key+':commit',async () => {
      const record=await this.read('postings',key);if(!record)return null;
      const metadata={revision:record.data.revision,pending:false,parserVersion:record.data.parserVersion,lastSuccessfulFetchAt:record.data.lastSuccessfulFetchAt || record.updatedAt,observedAt:null,snapshotStamp:record.fileStamp};
      const ttl=Math.max(0,Date.parse(record.expiresAt)-this.now());
      await this.update('manifest',key,() => metadata,{ttl});return record;
    });
  }
  async coordinateSearch(key,work) {
    let started=false;
    try{return await this.withLock('search',key+':collect',()=>{started=true;return work();});}
    catch(error){if(!started && ['EACCES','EPERM','ENOTDIR'].includes(error.code)){this.onWarning('Search cache lock unavailable; collecting without search coordination.');return work();}throw error;}
  }
  async coordinateRefresh(key,work,onBusy = () => {}) {
    try {return await this.withLock('postings',key+':refresh',() => work(false));}
    catch (error) {if (['EACCES','EPERM','ENOTDIR'].includes(error.code)) {this.onWarning('Cache refresh lock unavailable; collecting without refresh coordination.');return work(false);}if (!/cache is busy in another process/.test(error.message)) throw error;onBusy();return work(true);}
  }
  async flush() {await Promise.allSettled([...this.pending.values()]);}
  async pruneIfDue() {
    const previous=await this.read('maintenance','prune');
    if(previous && this.now()-Date.parse(previous.data.lastPrunedAt)<CACHE_TTL.prune)return false;
    return this.withLock('maintenance','prune:run',async()=>{
      const current=await this.read('maintenance','prune');
      if(current && this.now()-Date.parse(current.data.lastPrunedAt)<CACHE_TTL.prune)return false;
      await this.prune();await this.put('maintenance','prune',{lastPrunedAt:new Date(this.now()).toISOString()},{ttl:CACHE_TTL.prune});return true;
    });
  }
  async prune() {
    this.metrics.pruneRuns++;
    // Shards are independent; pruning never removes inventories or live locks.
    for (const kind of kinds) {
      const directory = join(this.root,kind);
      let files;
      try {files = await readdir(directory);} catch (error) {if (error.code === 'ENOENT') continue; throw error;}
      for (const file of files) {
        this.signal?.throwIfAborted();
        if (!/^[a-f0-9]{64}\.json(?:\.(?:corrupt|tmp)-[\w-]+)?$/.test(file)) continue;
        const path = join(directory,file), info = await stat(path).catch(() => null);
        if (!info || this.now() - info.mtimeMs < DAY) continue;
        if (/\.(?:tmp|corrupt)-/.test(file) || (['search','resolution'].includes(kind) && this.now() - info.mtimeMs > DAY) || (['postings','manifest'].includes(kind) && this.now() - info.mtimeMs > CACHE_TTL.stale)) {
          // Hold the writer's lock and recheck age to avoid deleting a fresh replacement.
          let lock;
          try {lock = await open(path + '.lock','wx',0o600);}
          catch (error) {if (error.code === 'EEXIST') continue; throw error;}
          try {
            const current = await stat(path).catch(() => null);
            if (current && current.mtimeMs === info.mtimeMs) await rm(path,{force:true});
          } finally {await lock.close(); await rm(path + '.lock',{force:true});}
        }
      }
    }
  }
}

function fileStamp(info) {return {size:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,ino:info.ino};}
function sameStamp(a,b) {return !!a && !!b && ['size','mtimeMs','ctimeMs','ino'].every(key => a[key]===b[key]);}
function validManifestTimes(record,now) {
 const observed=Date.parse(record.data.observedAt || record.data.lastSuccessfulFetchAt);
 return Number.isFinite(observed) && observed <= now && Date.parse(record.updatedAt)<=now && observed <= Date.parse(record.updatedAt) && (!record.data.observedAt || Date.parse(record.data.observedAt)===Date.parse(record.data.lastSuccessfulFetchAt));
}
