import {normalizeJob, validateJob, validSourceDate, clean, plainText} from '../schema.js';
import {normalizeWorkplace} from '../filters.js';

const reserved = new Set(['api','static','assets','_next','css','js','images','img','embed','robots.txt','favicon.ico','sitemap.xml']);
export const text = value => typeof value === 'string' ? clean(value) : '';
export function validBoardId(value) {
  return typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._&+'()-]{0,99}$/u.test(value) &&
    value === value.trim() && !reserved.has(value.toLowerCase()) && !/^root\./i.test(value) &&
    !/\.(?:js|css|json|xml|png|jpe?g|gif|svg|ico|woff2?|map)$/i.test(value);
}
export function assertBoard(board) {
  if (!board || !validBoardId(board.id) || !['global','eu'].includes(board.region || 'global')) throw new Error('Invalid ATS board identifier or region.');
  return encodeURIComponent(board.id);
}
export const boardKey = board => `${board.region || 'global'}:${board.id.normalize('NFC').toLowerCase()}`;
export function publicLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.toString() : null;
  } catch {return null;}
}
export function instant(value) {
  if (!validSourceDate(value) || typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function decodeDescription(value) {
  // Greenhouse may encode its description markup. Decode one layer before stripping.
  const first = plainText(value);
  return first && /<\/?[a-z][^>]*>/i.test(first) ? plainText(first) : first;
}
export function posting(source, board, raw, fields) {
  const id = String(raw.id ?? '');
  if (!/^[\w-]{1,128}$/.test(id) || !fields.title || !fields.url) return null;
  const employer = text(raw.company_name) || text(raw.companyName) || text(board.company) || null;
  const job = normalizeJob({source, id:`${boardKey(board)}:${id}`, providerJobId:id,
    boardId:board.id, region:board.region || 'global',
    company:employer || board.id, companyEvidence:employer ? 'observed' : 'board-identifier',
    ...fields, filterEvidence:'observed-or-unfiltered', unconfirmedFilters:[]});
  return validateJob(job).valid ? job : null;
}
export function observedWorkplace(value, location) {
  return normalizeWorkplace(value) || normalizeWorkplace(location);
}
export const emptyStats = () => ({pages:0,cardsSeen:0,rejected:0,detailRequests:0,unknownExcluded:0,facetReliant:[],errors:[]});
