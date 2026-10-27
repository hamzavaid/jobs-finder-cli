import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
export const fields = [
  'source', 'id', 'title', 'company', 'location', 'workplace', 'employmentType',
  'seniorityLevel', 'postedAt', 'postedText', 'applicantCount',
  'underTenApplicants', 'verified', 'filterEvidence', 'url', 'salary', 'description', 'datePrecision', 'unconfirmedFilters'
];
export function csvCell(value) {
  let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formula injection in untrusted scraped text.
  if (/^[\s\x00-\x1f]*[=+\-@]/.test(s)) s = '\'' + s;
  return `"${s.replaceAll('"', '""')}"`;
}
const short = (text, len) => {
  const s = text == null ? '—' : String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  return s.length > len ? s.slice(0, len - 1) + '…' : s.padEnd(len);
};
export function serializeJobs(jobs, format = 'table') {
  if (!['table','json','jsonl','csv'].includes(format)) throw new Error(`Unknown output format: ${format}`);
  if (format === 'json') return JSON.stringify(jobs, null, 2) + '\n';
  if (format === 'jsonl') return jobs.map(job => JSON.stringify(job)).join('\n') + (jobs.length ? '\n' : '');
  if (format === 'csv') {
    return [fields.map(csvCell).join(','), ...jobs.map(j => fields.map(k => csvCell(j[k])).join(','))].join('\n') + '\n';
  }
  if (!jobs.length) return 'No matching jobs found.\n';
  const head = `#    ${short('SITE', 9)} ${short('TITLE', 33)} ${short('COMPANY', 24)} ${short('LOCATION', 25)} ${short('POSTED', 14)} JOB ID`;
  const rows = jobs.map((j, i) =>
    `${String(i + 1).padEnd(4)} ${short(j.source || 'LinkedIn', 9)} ${short(j.title, 33)} ${short(j.company, 24)} ${short(j.location, 25)} ${short(j.postedText || j.postedAt, 14)} ${j.id}`
  );
  const warnings = jobs.some(j => j.unconfirmedFilters?.length)
    ? '\nNote: Some site filters could not be independently verified. See --format json / --strict.\n' : '';
  return [head, '-'.repeat(head.length), ...rows, '', 'Use --format json for each job URL.', warnings].join('\n');
}
export async function emit(text, outputFile = null, stdout = process.stdout) {
  if (!outputFile) {stdout.write(text); return;}
  await mkdir(dirname(outputFile), {recursive:true});
  await writeFile(outputFile, text, 'utf8');
}
