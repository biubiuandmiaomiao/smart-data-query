import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
if(Number(process.versions.node.split('.')[0])<22){
  console.error('请使用 Node.js 22 或以上版本。Windows 请双击 start.cmd。');
  process.exit(1);
}
try {
  if(!fs.existsSync('.env')){
    fs.copyFileSync('.env.example','.env',fs.constants.COPYFILE_EXCL);
    console.log('已创建空白 .env。可先打开界面；真实查数前请填写数据库配置并重启。');
  }
  const {default:dotenv}=await import('dotenv');
  dotenv.config({path:path.join(root,'.env'),quiet:true});
  const port=Number(process.env.PORT||4173);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('.env 中 PORT 必须是 1 到 65535 的整数');
  const {app}=await import('../server/app.js');
  const server=app.listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${port}/?view=metrics`;
    console.log(`\n营销数据字典已启动：${url}\n保持本窗口开启；按 Ctrl+C 停止服务。`);
    if(!process.env.DB_HOST||!process.env.DB_USER||!process.env.DB_PASSWORD){
      console.log('数据库尚未配置：请编辑 .env，再重启；唯一业务库为 d_root_project_marketing_db。');
    }
    if(process.argv.includes('--open')&&process.platform==='win32'){
      const browser=spawn('cmd.exe',['/d','/c','start','',url],{stdio:'ignore',windowsHide:true});
      browser.on('error',()=>console.log('未能自动打开浏览器，请复制上方地址手动打开。'));
      browser.unref();
    }
  });
  server.on('error',error=>{
    console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用。请在 .env 中修改 PORT 后重新启动。`:`启动失败：${error.code||error.message}`);
    process.exit(1);
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    server.close(()=>process.exit(0));
    setTimeout(()=>process.exit(0),2000).unref();
  });
}catch(error){
  console.error(error.code==='ERR_MODULE_NOT_FOUND'?'依赖缺失，请重新完整解压，或安装 Node.js 后执行 npm ci。':`启动失败：${error.code||error.message}`);
  process.exit(1);
}
