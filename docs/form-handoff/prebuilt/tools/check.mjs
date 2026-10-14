import {mkdtempSync,writeFileSync,mkdirSync,copyFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve,join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=mkdtempSync(join(tmpdir(),'form-contracts-'));
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(r.error||r.status!==0)throw r.error||new Error(`Exit ${r.status}`);};
try {
 const configured=process.env.FORM_TSC_BIN;
 const repoTsc=resolve(root,'../../../node_modules/.bin/tsc');
 const compiler=configured||(existsSync(repoTsc)?repoTsc:'tsc');
 const files=readdirSync(join(root,'shared')).filter(f=>f.endsWith('.ts')).map(f=>join(root,'shared',f));
 const config={compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',strict:true,lib:['ES2023','DOM'],types:[],rootDir:root,outDir:out,noEmitOnError:true},files};
 writeFileSync(join(out,'tsconfig.json'),JSON.stringify(config));run(compiler,['-p',join(out,'tsconfig.json')]);
 writeFileSync(join(out,'package.json'),'{"type":"module"}');mkdirSync(join(out,'tests'));
 const tests=readdirSync(join(root,'tests')).filter(f=>f.endsWith('.test.mjs')).sort();
 for(const f of tests)copyFileSync(join(root,'tests',f),join(out,'tests',f));
 run(process.execPath,['--test',...tests.map(f=>join(out,'tests',f))]);
} catch(e){console.error(e);process.exitCode=1;} finally {rmSync(out,{recursive:true,force:true});}
