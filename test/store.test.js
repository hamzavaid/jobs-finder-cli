import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveJobs, savedJobs, statsForSaved} from '../src/store.js';

test('locally saved jobs upsert by ID and summarize', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ljobs-test-'));
  const path = join(dir, 'nested', 'db.json');
  try {
    await saveJobs([{id:'12345', title:'Cook', company:'Acme'}], path);
    await saveJobs([{id:'12345', title:'Head Cook', company:'Acme'}, {id:'45678', title:'Accountant', company:'Another'}], path);
    const rows = await savedJobs(path);
    assert.equal(rows.length, 2);
    assert.equal(rows.find(x=>x.id==='12345').title, 'Head Cook');
    const stats = await statsForSaved(path);
    assert.equal(stats.total, 2);
    assert.equal(stats.byCompany.Acme, 1);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});
