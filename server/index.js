import 'dotenv/config';
import { app } from './app.js';
const server=app.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`智能取数 http://localhost:${process.env.PORT||4173}`));
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被占用，请关闭旧实例或修改PORT':error.message);process.exitCode=1;});
