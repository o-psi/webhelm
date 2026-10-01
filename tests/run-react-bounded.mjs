// Keep local verification out of the desktop app's cgroup and bound native RSS,
// not just V8 heap. Each file has its own process, memory limit and timeout.
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='linux') {
    throw Error('This bounded verification entry point requires Linux and a systemd user manager.');
}
const files=readdirSync(resolve(root,'tests')).filter(name=>/^react-.*\.test\.ts$/.test(name)).sort();
if(!files.length)throw Error('No React test files found.');
for(const file of files) {
    const unit=`voyage-react-${randomUUID()}`;
    const args=['--user','--wait','--pipe','--collect',`--unit=${unit}`,
        '-p','MemoryMax=1G','-p','MemorySwapMax=0','-p','RuntimeMaxSec=25s',
        `--working-directory=${root}`,'/usr/bin/env','NODE_OPTIONS=--max-old-space-size=512',
        process.execPath,'--import','tsx','--test','--test-concurrency=1',
        '--test-timeout=15000',resolve(root,'tests',file)];
    const result=spawnSync('systemd-run',args,{cwd:root,stdio:'inherit',timeout:35000});
    if(result.error||result.status!==0) {
        // The independently managed service also has its own runtime deadline.
        spawnSync('systemctl',['--user','stop',unit],{stdio:'ignore',timeout:5000});
        console.error(`React verification stopped at ${file}; no unrestricted fallback.`);
        process.exitCode=1;
        break;
    }
}
