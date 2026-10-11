import {mkdtempSync,writeFileSync,mkdirSync,copyFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=mkdtempSync(join(tmpdir(),'form-v2-tests-'));
const modules=['edit-plan','task-policy','credit-reservations','launch-policy','provider-prompt','form-quality-policy'];
const referenceTests=['contracts.test.mjs','credit.test.mjs','task-launch.test.mjs','quality.test.mjs'];
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(r.error||r.status!==0)throw r.error||new Error(`Exit ${r.status}`);};
try {
 const local=join(root,'node_modules/.bin/tsc');
 const compiler=process.env.FORM_TSC_BIN||(existsSync(local)?local:'tsc');
 const config={compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',strict:true,lib:['ES2023','DOM'],types:[],rootDir:root,outDir:out,noEmitOnError:true},files:modules.map(f=>join(root,'shared/v2',f+'.ts'))};
 writeFileSync(join(out,'tsconfig.json'),JSON.stringify(config));run(compiler,['-p',join(out,'tsconfig.json')]);
 writeFileSync(join(out,'package.json'),'{'+'"type":"module"'+'}');mkdirSync(join(out,'tests/v2'),{recursive:true});
 for(const f of referenceTests)copyFileSync(join(root,'tests/v2',f),join(out,'tests/v2',f));
 run(process.execPath,['--test',...referenceTests.map(f=>join(out,'tests/v2',f))]);
 const other=readdirSync(join(root,'tests/v2')).filter(f=>/\.test\.(ts|tsx|mjs)$/.test(f)&&!referenceTests.includes(f)).sort();
 if(other.length)run(process.execPath,['--import','tsx','--test',...other.map(f=>join(root,'tests/v2',f))]);
} catch(e){console.error(e);process.exitCode=1;} finally {rmSync(out,{recursive:true,force:true});}
