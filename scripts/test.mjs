import {spawnSync} from 'node:child_process';
import {readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.test.js')).map(f=>path.join(root,'test',f));
const dataDir=mkdtempSync(path.join(tmpdir(),'marketing-package-test-'));
const env={...process.env,DATA_DIR:dataDir};
for(const key of ['DB_HOST','DB_USER','DB_PASSWORD','DEEPSEEK_API_KEY'])delete env[key];
try{
  const result=spawnSync(process.execPath,['--test',...files],{cwd:root,env,stdio:'inherit'});
  process.exitCode=result.status??1;
}finally{
  // This exact temporary directory was created above for this run only.
  rmSync(dataDir,{recursive:true,force:true});
}
