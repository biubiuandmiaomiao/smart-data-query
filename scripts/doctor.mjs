import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
let failed=false;
function report(ok,message){console.log(`${ok?'[通过]':'[需处理]'} ${message}`);if(!ok)failed=true;}
report(Number(process.versions.node.split('.')[0])>=22,`Node ${process.versions.node}，${process.platform}/${process.arch}`);
try{
  for(const name of ['dotenv','express','mysql2','zod'])await import(name);
  report(true,'运行依赖齐全');
  const {default:dotenv}=await import('dotenv');dotenv.config({path:'.env',quiet:true});
  report(fs.existsSync('.env'),'配置文件 .env 已创建；没有时先运行 start.cmd / start.sh');
  const dir=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):path.join(root,'.data');
  fs.mkdirSync(dir,{recursive:true});
  const probe=path.join(dir,`.write-check-${process.pid}`);
  fs.writeFileSync(probe,'ok',{flag:'wx'});fs.unlinkSync(probe);report(true,'本地状态目录可写');
  const {getPool,checkDatabase}=await import('../server/db.js');
  const status=await checkDatabase();
  report(status.connected,status.configured?`数据库连接：${status.connected?'成功':status.error}`:'请填写 DB_HOST、DB_USER、DB_PASSWORD 后重试');
  if(status.connected){
    const [[row]]=await getPool().execute('SELECT COUNT(*) AS tableCount FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',['d_root_project_marketing_db']);
    report(Number(row.tableCount)>0,`数据库可见表/视图数量：${row.tableCount}`);
    console.log('连通性检查不等于所有表都具有读取权限；请再从界面试跑一个指标。');
  }
  if(getPool())await getPool().end();
  console.log('模型是可选配置；请在“连接与模型”页面保存并测试，不在自检日志输出密钥。');
}catch(error){report(false,`自检失败：${error.code||error.name}`);}
process.exitCode=failed?1:0;
