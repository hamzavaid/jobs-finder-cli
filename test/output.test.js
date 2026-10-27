import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serializeJobs, csvCell, emit, fields} from '../src/output.js';
const rows = [{source:'Glassdoor',id:'123456',title:'Chef, "Lead"\nKitchen',company:'Bäckerei',description:'Bake & decorate',salary:'$30/hr',verified:null}];
test('JSON and JSONL preserve full records, Unicode, newlines and explicit null', () => {
  assert.deepEqual(JSON.parse(serializeJobs(rows,'json')),rows);
  assert.deepEqual(serializeJobs([...rows,...rows],'jsonl').trim().split('\n').map(JSON.parse),[...rows,...rows]);
  assert.equal(serializeJobs([],'jsonl'),''); assert.deepEqual(JSON.parse(serializeJobs([],'json')),[]);
});
test('CSV exports stable fields, multiline quotes, salary/description and neutralizes formulas', () => {
  const csv = serializeJobs(rows,'csv');
  assert.ok(csv.includes('"Chef, ""Lead""\nKitchen"')); assert.ok(csv.includes('"$30/hr"'));
  assert.ok(fields.includes('description')); assert.ok(fields.includes('salary'));
  for (const value of ['=CMD()','\t+SUM(A1)','\r@bad',' -1']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(null),'""'); assert.equal(csvCell(false),'"false"');
});
test('table sanitizes terminal controls and serializer rejects unsupported formats', () => {
  const table = serializeJobs([{title:'Chef\x1b[31m\nOverwrite',source:'Glassdoor'}]);
  assert.ok(!table.includes('\x1b')); assert.ok(!table.includes('m\nOverwrite'));
  assert.throws(() => serializeJobs(rows,'xml'), /Unknown output format/);
});
test('emit writes nested paths and supports injectable stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(),'jobs-output-'));
  try {
    const path = join(dir,'nested','jobs.json');
    await emit(serializeJobs(rows,'json'),path);
    assert.deepEqual(JSON.parse(await readFile(path,'utf8')),rows);
    const chunks = []; await emit('abc',null,{write:text => chunks.push(text)}); assert.deepEqual(chunks,['abc']);
  } finally {await rm(dir,{recursive:true,force:true});}
});
