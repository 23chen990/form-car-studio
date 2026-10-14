/** Explicit add-only installation. No overwrite, git mutation, network or npm install. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,isAbsolute,relative} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const pre=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),write=args.includes('--write');
if(args.some(x=>x!=='--write'))throw new Error('Only --write is accepted; default is dry-run');
const root=realpathSync(process.cwd());
const git=(...a)=>{const r=spawnSync('git',['-C',root,...a],{encoding:'utf8'});if(r.error||r.status!==0)throw new Error('Git check failed');return r.stdout.trim()};
if(realpathSync(git('rev-parse','--show-toplevel'))!==root)throw new Error('Run from repository root');
if(!git('branch','--show-current').startsWith('codex/form-'))throw new Error('Not an authorized implementation branch');
if(!['https://github.com/23chen990/form-car-studio.git','https://github.com/23chen990/form-car-studio','git@github.com:23chen990/form-car-studio.git'].includes(git('remote','get-url','origin')))throw new Error('Wrong origin');
if(git('status','--porcelain'))throw new Error('Worktree must be clean; no automatic stash/reset');
const modules=['edit-plan','task-policy','credit-reservations','launch-policy','provider-prompt','form-quality-policy'];
const tests=['contracts.test.mjs','credit.test.mjs','task-launch.test.mjs','quality.test.mjs'];
const planned=modules.map(n=>['shared/v2/'+n+'.ts',readFileSync(join(pre,'shared',n+'.ts'),'utf8')]);
for(const n of tests)planned.push(['tests/v2/'+n,readFileSync(join(pre,'tests',n),'utf8').replaceAll('../shared/','../../shared/v2/')]);
planned.push(['tools/check-v2.mjs',readFileSync(join(pre,'tools/application-check.template.mjs'),'utf8')]);
for(const [name] of planned){const full=resolve(root,name);if(isAbsolute(relative(root,full))||relative(root,full).startsWith('..'))throw new Error('Unsafe target');if(existsSync(full))throw new Error('Refusing existing target: '+name);let p=dirname(full);while(p!==root){if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error('Symlink parent forbidden');p=dirname(p);}}
if(write)for(const [name,content]of planned){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,content,{flag:'wx'});}
console.log(JSON.stringify({status:write?'FILES_ADDED_NOT_COMMITTED':'DRY_RUN_NO_WRITES',paths:planned.map(x=>x[0])},null,2));
