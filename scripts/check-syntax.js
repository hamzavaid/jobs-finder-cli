import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

async function check(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path = join(directory,entry.name);
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
      if (result.error) throw result.error;
      if (result.status !== 0) process.exitCode = 1;
    }
  }
}
for (const directory of ['bin','src','test','scripts']) await check(directory);
