import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketingSeeds } from './seeds.js';
import { MARKETING_DATABASE } from './policy.js';
const dir = process.env.DATA_DIR || fileURLToPath(new URL('../.data', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const filename = path.join(dir, 'workspace.json');
const initial = () => ({ version:3,fields:{},sources:{},queries:[],settings:{model:'deepseek-chat',baseUrl:'https://api.deepseek.com',apiKey:''},metrics:marketingSeeds() });
let data=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):initial();
if(data.version<3){
 fs.mkdirSync(path.join(dir,'archives'),{recursive:true});
 fs.writeFileSync(path.join(dir,`archives/before-marketing-${Date.now()}.json`),JSON.stringify(data,null,2),{mode:0o600});
 const prefix=MARKETING_DATABASE+'.';
 data.metrics=data.metrics.filter(m=>m.source.startsWith(prefix));
 for(const m of marketingSeeds())if(!data.metrics.some(x=>x.id===m.id))data.metrics.push(m);
 data.sources=Object.fromEntries(Object.entries(data.sources).filter(([id])=>id.startsWith(prefix)));
 data.fields=Object.fromEntries(Object.entries(data.fields).filter(([id])=>id.startsWith(prefix)));
 data.queries=data.queries.filter(q=>q.metric.source.startsWith(prefix));
 data.version=3;
}
export function readStore(){return structuredClone(data);}
export function mutateStore(fn){const next=structuredClone(data);const result=fn(next);fs.writeFileSync(filename+'.tmp',JSON.stringify(next,null,2),{mode:0o600});fs.renameSync(filename+'.tmp',filename);data=next;return result;}
mutateStore(()=>{});
export function modelSettings(){const settings=readStore().settings;return {...settings,apiKey:settings.apiKey||process.env.DEEPSEEK_API_KEY||''};}
export function publicSettings(){const {apiKey,...settings}=modelSettings();return {...settings,configured:Boolean(apiKey),keyHint:apiKey?'已保存密钥':'未配置密钥'};}
