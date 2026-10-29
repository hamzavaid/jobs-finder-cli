import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressReporter} from '../src/progress.js';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('TTY progress is concise, sanitizes remote text and never writes stdout', () => {
  const errors = [],output = [],stderr = {isTTY:true,columns:100,write:value => errors.push(value)},stdout = {isTTY:true,write:value => output.push(value)};
  const progress = new ProgressReporter({stderr,stdout,env:{}});
  progress.start({search:'Chef',websites:['Ashby']});progress.update('Ashby','fetching jobs: 1 / 3 boards\x1b[2J');progress.draw();progress.finish(4,{partial:true});
  assert.equal(output.length,0);assert.ok(errors.some(value => value.includes('1 / 3 boards')));assert.ok(errors.some(value => value.includes('partial coverage')));assert.equal(progress.timer,null);
});
test('redirected streams and CI never animate or print progress', () => {
  for (const [tty,env] of [[false,{}],[true,{CI:'true'}]]) {
    const chunks = [],stream = {isTTY:tty,write:value => chunks.push(value)};
    const reporter = new ProgressReporter({stderr:stream,stdout:stream,env});reporter.start({search:'chef',websites:['Ashby']});reporter.update('Ashby','loading');reporter.draw();reporter.finish(0);assert.deepEqual(chunks,[]);
  }
});
test('CLI SIGINT aborts an active discovery request and returns exit 130 without success output', async () => {
  const root = await mkdtemp(join(tmpdir(),'ats-cancel-'));
  try {
    const script = `globalThis.fetch = async (_,init) => new Promise((_,reject) => init.signal.addEventListener('abort',() => reject(init.signal.reason),{once:true})); const {runCli} = await import('./src/cli.js');setTimeout(() => process.emit('SIGINT'),100);await runCli(['node','jobs','find','--website','Ashby','--search','chef','--format','json']);`;
    const result = spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,JOBS_CACHE_DIR:root},timeout:10000});
    assert.equal(result.status,130,result.stderr);assert.equal(result.stdout,'');assert.match(result.stderr,/Search canceled/);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('multiple providers retain independent activities and completed or failed rows', () => {
  const chunks = [],stderr = {isTTY:true,columns:90,rows:24,write:value => chunks.push(value)},stdout = {isTTY:true,write:() => assert.fail('progress reached stdout')};
  const progress = new ProgressReporter({stderr,stdout,env:{}});
  progress.start({search:'Chef',websites:['LinkedIn','Greenhouse','Ashby']});
  progress.update('Greenhouse','fetching jobs: 25 / 100 boards');
  progress.update('LinkedIn','3 matching jobs collected');
  progress.update('Ashby','provider failed');
  progress.update('Cache','cache warning');progress.draw();
  const latest = chunks.at(-1);
  assert.match(latest,/LinkedIn.*\[##########\].*3 matching jobs collected/);
  assert.match(latest,/Greenhouse.*fetching jobs: 25 \/ 100 boards/);
  assert.match(latest,/Ashby.*\[!---------\].*provider failed/);
  assert.ok(latest.indexOf('LinkedIn') < latest.indexOf('Greenhouse'));
  progress.finish(3,{partial:true});
  assert.ok(chunks.at(-2).includes('fetching jobs: 25 / 100 boards'));
  assert.equal(progress.timer,null);
});

test('narrow terminals and canceled searches keep safe per-provider output and clean up', () => {
  const chunks = [],stream = {isTTY:true,columns:24,rows:24,write:value => chunks.push(value)};
  const progress = new ProgressReporter({stderr:stream,stdout:stream,env:{}});
  progress.start({search:'Chef',websites:['Greenhouse','Lever']});
  progress.update('Greenhouse','loading\x1b]0;untrusted title\x07');progress.update('Search','canceling');
  assert.ok(progress.render().every(line => line.length <= 23));progress.close();
  const final = chunks.at(-1);assert.match(final,/Greenhouse: Canceling/);assert.match(final,/Lever: Canceling/);
  assert.equal(progress.timer,null);const count = chunks.length;progress.close();assert.equal(chunks.length,count);
});
