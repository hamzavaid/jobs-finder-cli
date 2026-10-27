import {createHash,randomUUID} from 'node:crypto';
import {validBoardId,boardKey} from './ats/shared.js';

const DAY = 86400000;
export const DISCOVERY_TTL = Object.freeze({full:30 * DAY,recent:DAY,validation:7 * DAY});
const time = value => Date.parse(value || '') || 0;
export const inventoryKey = provider => provider.name;
export function extractBoard(value,provider) {
  try {
    const url = new URL(value);
    if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port || !provider.domains.includes(url.hostname)) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
    const id = provider.name === 'Greenhouse' && first === 'embed'
      ? url.searchParams.get('for') : decodeURIComponent(first || '');
    if (!validBoardId(id)) return null;
    return {provider:provider.name,id:id.normalize('NFC'),region:url.hostname === 'jobs.eu.lever.co' ? 'eu' : 'global'};
  } catch {return null;}
}
export function parseCdx(body) {
  let rows, trailing = '';
  try {rows = JSON.parse(body);}
  catch {
    const split = body.lastIndexOf('\n\n');
    if (split < 0) throw new Error('Wayback returned invalid CDX JSON.');
    try {rows = JSON.parse(body.slice(0,split)); trailing = body.slice(split).trim();}
    catch {throw new Error('Wayback returned invalid CDX JSON.');}
  }
  if (!Array.isArray(rows)) throw new Error('Wayback returned a non-array CDX payload.');
  if (!rows.length) return {urls:[],resumeKey:trailing || null};
  const column = Array.isArray(rows[0]) ? rows[0].indexOf('original') : -1;
  if (column < 0) throw new Error('Wayback CDX header lacks original URLs.');
  const urls = [];
  let resumeKey = trailing || null, resumeSection = false;
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) throw new Error('Invalid CDX record.');
    if (!row.length) {resumeSection = true; continue;}
    if (resumeSection) {
      if (row.length !== 1 || typeof row[0] !== 'string') throw new Error('Invalid CDX resume key.');
      resumeKey = row[0];
    } else if (typeof row[column] === 'string') urls.push(row[column]);
    else throw new Error('Invalid CDX URL.');
  }
  if (resumeKey && resumeKey.length > 8192) throw new Error('Invalid oversized CDX resume key.');
  return {urls,resumeKey};
}
export function makeCdxUrl(domain,{resumeKey,from,limit = 1000} = {}) {
  const url = new URL('https://web.archive.org/cdx/search/cdx');
  for (const [key,value] of Object.entries({url:`${domain}/*`,matchType:'host',output:'json',fl:'original',collapse:'urlkey',filter:'statuscode:200',limit,showResumeKey:'true',resumeKey,from})) {
    if (value !== undefined && value !== null) url.searchParams.set(key,String(value));
  }
  return url.toString();
}
export async function validateBoard(provider,board,http) {
  const url = provider.apiUrl(board,provider.name === 'Lever' ? {limit:1} : {compensation:false});
  try {
    try {
      const result = await http.head(url);
      if (result.status === 200 && !/text\/html/i.test(result.headers?.get?.('content-type') || '')) return {status:'valid',method:'HEAD'};
    } catch (error) {
      if (![400,404,405,501].includes(error.status)) throw error;
    }
    const data = await http.json(url);
    const valid = provider.name === 'Lever' ? Array.isArray(data) : Array.isArray(data?.jobs);
    if (!valid) throw new Error(`${provider.name}: board validation returned an invalid payload.`);
    return {status:'valid',method:'GET'};
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return {status:[404,410].includes(error.status) ? 'invalid' : 'temporary-error',error:error.message,httpStatus:error.status || null,retryAt:error.retryAt || null};
  }
}
export function mergeInventory(previous,next) {
  const merged = new Map();
  for (const board of [...(previous?.boards || []),...next.boards]) {
    const key = boardKey(board), old = merged.get(key);
    merged.set(key,old && time(old.validationAttemptAt) > time(board.validationAttemptAt) ? {...board,...old} : {...old,...board});
  }
  return {...previous,...next,boards:[...merged.values()],revision:randomUUID()};
}
export class DiscoveryManager {
  constructor({cache,http,now = Date.now,maxPages = 2,maxValidations = 32,fallback = true,report = () => {},signal} = {}) {
    Object.assign(this,{cache,http,now,maxPages,maxValidations,fallback,report,signal});
  }
  async ensure(provider) {
    const previous = (await this.cache.read('inventory',provider.name))?.data;
    const inventory = structuredClone(previous || {provider:provider.name,boards:[],cursors:{},revision:randomUUID()});
    if (inventory.nextDiscoveryAt && time(inventory.nextDiscoveryAt) > this.now()) {
      this.report(provider.name,'cached boards loaded');
      return {inventory,errors:inventory.lastDiscoveryErrors || [],complete:inventory.coverageComplete === true};
    }
    this.report(provider.name,'discovering company boards');
    const errors = [], candidates = new Map(inventory.boards.map(board => [boardKey(board),board]));
    const mode = this.now() - time(inventory.lastFullAt) >= DISCOVERY_TTL.full ? 'full' : 'recent';
    let allDone = true, archiveSucceeded = false;
    for (const domain of provider.domains) {
      this.signal?.throwIfAborted();
      const cursorKey = `${mode}:${domain}`;
      const old = inventory.cursors[cursorKey] || {};
      // A completed previous pass starts again when its TTL expires.
      const completedPass = inventory[mode === 'full' ? 'lastFullAt' : 'lastRecentAt'];
      const state = old.done && time(old.completedAt) <= time(completedPass) ? {} : old;
      if (state.done) {archiveSucceeded = true;continue;}
      let resumeKey = state.resumeKey || null, done = false;
      const from = state.from || (mode === 'recent' ? new Date(this.now() - 30 * DAY).toISOString().slice(0,10).replaceAll('-','') : null);
      try {
        for (let page = 0; page < this.maxPages; page++) {
          this.signal?.throwIfAborted();
          const {urls,resumeKey:next} = parseCdx(await this.http.text(makeCdxUrl(domain,{resumeKey,from})));
          archiveSucceeded = true;
          for (const value of urls) this.addCandidate(candidates,value,provider,'wayback');
          if (next && next === resumeKey) throw new Error('Wayback repeated its resume key.');
          resumeKey = next;
          if (!next) {done = true; break;}
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        errors.push(`Wayback ${domain}: ${error.message}`);
      }
      inventory.cursors[cursorKey] = {resumeKey,from,done,completedAt:done ? new Date(this.now()).toISOString() : null};
      allDone &&= done;
    }
    if (!archiveSucceeded && this.fallback) {
      try {await this.commonCrawl(provider,candidates,inventory);}
      catch (error) {if (error.name === 'AbortError') throw error; errors.push(`Common Crawl: ${error.message}`);}
    }
    const due = [...candidates.values()].filter(board => board.status !== 'valid' || this.now() - time(board.lastValidatedAt) >= DISCOVERY_TTL.validation)
      .filter(board => !board.retryAt || time(board.retryAt) <= this.now()).slice(0,this.maxValidations);
    // Fixed worker pool; validation never submits the entire inventory at once.
    let index = 0,blocked = false;
    await Promise.all(Array.from({length:Math.min(2,due.length)},async () => {
      while (index < due.length && !blocked) {
        this.signal?.throwIfAborted();
        const board = due[index++], validation = await validateBoard(provider,board,this.http);
        const stamp = new Date(this.now()).toISOString();
        board.validationAttemptAt = stamp; board.validation = validation;
        if (validation.status === 'valid') {board.status = 'valid'; board.lastValidatedAt = stamp; board.retryAt = null;}
        else if (validation.status === 'invalid') {board.status = 'invalid'; board.invalidAt = stamp; board.retryAt = new Date(this.now() + DISCOVERY_TTL.validation).toISOString();}
        else {
          board.retryAt = validation.retryAt || new Date(this.now() + 15 * 60000).toISOString();board.lastError = validation.error;
          if ([401,403,429].includes(validation.httpStatus)) {blocked = true;inventory.providerRetryAt = board.retryAt;}
        }
      }
    }));
    inventory.boards = [...candidates.values()];
    const stamp = new Date(this.now()).toISOString();
    inventory.lastAttemptAt = stamp;
    if (allDone && archiveSucceeded) {inventory[mode === 'full' ? 'lastFullAt' : 'lastRecentAt'] = stamp;}
    inventory.coverageComplete = allDone && archiveSucceeded && !inventory.boards.some(board => board.status === 'pending');
    inventory.lastDiscoveryErrors = errors;
    inventory.nextDiscoveryAt = new Date(this.now() + (!archiveSucceeded ? 15 * 60000 : allDone ? DAY : 3600000)).toISOString();
    let saved;
    try {saved = await this.cache.update('inventory',provider.name,current => mergeInventory(current,inventory));}
    catch (error) {if (error.name === 'AbortError') throw error;errors.push(`Cache inventory write failed: ${error.message}`);saved = {data:inventory};}
    this.report(provider.name,`discovery ${allDone && archiveSucceeded ? 'completed' : 'partial'}; ${saved.data.boards.filter(b => b.status === 'valid').length} valid boards`);
    return {inventory:saved.data,errors,complete:inventory.coverageComplete};
  }
  addCandidate(candidates,value,provider,discoveredBy) {
    const candidate = extractBoard(value,provider);
    if (!candidate) return;
    const key = boardKey(candidate), old = candidates.get(key);
    if (!old && candidates.size >= 50000) throw new Error('Discovery inventory size limit reached; coverage is partial.');
    const stamp = new Date(this.now()).toISOString();
    candidates.set(key,{...candidate,status:'pending',firstDiscoveredAt:stamp,...old,lastDiscoveredAt:stamp,discoveredBy});
  }
  async commonCrawl(provider,candidates,inventory) {
    const collections = await this.http.json('https://index.commoncrawl.org/collinfo.json');
    const collection = collections?.[0];
    const api = new URL(collection?.['cdx-api']);
    if (api.origin !== 'https://index.commoncrawl.org' || !/^\/CC-MAIN-\d{4}-\d{2}-index$/.test(api.pathname) || api.search) throw new Error('Untrusted Common Crawl index URL.');
    for (const domain of provider.domains) {
      const key = `commoncrawl:${collection.id}:${domain}`, old = inventory.cursors[key] || {page:0};
      const url = new URL(api);
      for (const [name,value] of Object.entries({url:`${domain}/*`,output:'json',fl:'url',page:old.page,pageSize:1})) url.searchParams.set(name,String(value));
      const text = await this.http.text(url.toString());
      const lines = text.split('\n').filter(line => line.trim());
      for (const line of lines) this.addCandidate(candidates,JSON.parse(line).url,provider,'commoncrawl');
      inventory.cursors[key] = {page:lines.length ? old.page + 1 : 0};
    }
  }
}
export const inventoryFingerprint = inventory => createHash('sha256').update(JSON.stringify(inventory.boards.map(b => [boardKey(b),b.status]).sort())).digest('hex');
