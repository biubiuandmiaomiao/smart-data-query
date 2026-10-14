import {resultEvidence} from './result-evidence.js';
import {inclusiveEnd, resultSummary} from '../public/workflow.js';
import {explainField} from './field-explanation.js';
import {loadEvidence, requireEvidence} from './evidence.js';
import {fieldSignature} from './business-guide.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import { analyzeWithModel } from './agent.js';
import { callModel } from './model.js';
import { readStore, mutateStore, publicSettings } from './store.js';
import { listTables, getSource, decoratedSource } from './schema.js';
import { buildQuery, validateMetric } from './sql-builder.js';
import { checkDatabase, getPool } from './db.js';
import { fieldValues } from './field-values.js';
import { MARKETING_DATABASE, assertMarketingSource, inferField } from './policy.js';
export const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.use(express.json({ limit: '250kb' }));
// Local workspace application: reject cross-origin writes and bind to loopback.
app.use('/api', (req,res,next) => {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: '不允许跨站请求' });
  res.set('Cache-Control','no-store'); next();
});
const route = fn => async (req,res,next) => { try { await fn(req,res); } catch(e) { next(e); } };
app.get('/api/health', route(async (_req,res) => res.json({ database: await checkDatabase(), model: publicSettings() })));
app.get('/api/workspace', (_req,res) => { const s=readStore(); res.json({ database: MARKETING_DATABASE, metrics: s.metrics, sources: Object.values(s.sources).map(decoratedSource), queries: s.queries, favorites:s.favorites||[], settings: publicSettings() }); });
app.get('/api/tables', route(async (req,res) => res.json(await listTables(req.query.refresh==='true'))));
app.get('/api/field-values',route(async(req,res)=>res.json(await fieldValues(String(req.query.source||''),String(req.query.field||'')))));
app.post('/api/field-explanation',route(async(req,res)=>{const input=z.object({source:z.string(),field:z.string()}).parse(req.body);res.json(await explainField(input.source,input.field));}));
app.post('/api/evidence',route(async(req,res)=>res.json(await loadEvidence(req.body))));
app.get('/api/source', route(async (req,res) => res.json(decoratedSource(await getSource(String(req.query.id || ''), req.query.refresh === 'true')))));
app.put('/api/fields', route(async (req,res) => {
  const { source, name, label, description, sensitivity, role, unit, confirmed, evidenceId, valueLabels } = z.object({ source:z.string(), name:z.string(), label:z.string().max(100), description:z.string().max(2000), sensitivity:z.enum(['normal','internal','restricted']),role:z.enum(['scope','time','measure','derived','snapshot','technical']),unit:z.string().max(30).default(''),confirmed:z.boolean().default(false),evidenceId:z.string().optional(),valueLabels:z.record(z.string().max(1000),z.string().max(100)).refine(v=>Object.keys(v).length<=50).default({}) }).parse(req.body);
  const schema=await getSource(source); if(!schema.columns.some(c=>c.name===name)) throw new Error('字段不存在');
  const column=schema.columns.find(c=>c.name===name);
  if(role==='measure' && (!/int|decimal|float|double|numeric/i.test(column.type) || ['scope','derived','snapshot','time'].includes(inferField(column).role) || column.name==='id'))throw new Error('标识、比率、余额和时间字段不能直接改成可加总数值');
  if(role==='time' && !/date|timestamp/i.test(column.type))throw new Error('业务时间必须是日期类型');
  if(confirmed){if(!label.trim()||!description.trim())throw new Error('请填写用户能理解的名称和业务解释');requireEvidence(evidenceId,source,column);}
  mutateStore(s=>{s.fields[`${source}.${name}`]={label,description,sensitivity,role,unit,valueLabels,...(confirmed?{confirmedAt:new Date().toISOString(),confirmedSignature:fieldSignature(column)}:{})};}); res.json({ok:true});
}));
const metricSchema=z.object({name:z.string().trim().min(1).max(100),description:z.string().trim().min(1).max(3000),aliases:z.array(z.string().max(100)).max(30).default([]),source:z.string(),aggregation:z.enum(['sum','avg','min','max','count','count_distinct','ratio','ratio_of_sums']),denominatorField:z.string().default(''),multiplier:z.coerce.number().positive().finite().default(1),snapshotPolicy:z.enum(['none','latest_per_day']).default('none'),valueField:z.string().default(''),distinctFields:z.array(z.string()).max(10).default([]),timeField:z.string(),dimension:z.string().default(''),scale:z.coerce.number().positive().finite(),unit:z.string().max(30),owner:z.string().max(100),status:z.enum(['draft','active']),notes:z.string().max(3000).default(''),filters:z.array(z.object({field:z.string(),operator:z.enum(['eq','ne','gt','gte','lt','lte','not_null','is_null','in']),value:z.union([z.string(),z.number(),z.boolean(),z.array(z.union([z.string(),z.number()])).max(50)]).default('')})).max(20).default([]),revision:z.number().optional()});
async function saveMetric(req,res) {
  const data=metricSchema.parse(req.body), source=await getSource(data.source);
  validateMetric(data,source);
  const saved=mutateStore(s=>{
    const old=req.params.id?s.metrics.find(m=>m.id===req.params.id):null;
    if(req.params.id&&!old) throw new Error('指标不存在');
    if(old&&data.revision!==old.revision) throw new Error('指标已被修改，请重新打开后保存');
    if(s.metrics.some(m=>m.name===data.name&&m.id!==old?.id)) throw new Error('指标名称已存在');
    const item={...data,id:old?.id||randomUUID(),revision:(old?.revision||0)+1,updatedAt:new Date().toISOString()};
    if(old) s.metrics[s.metrics.indexOf(old)]=item; else s.metrics.push(item); return item;
  });res.json(saved);
}
app.put('/api/favorites/:id',route(async(req,res)=>{const {favorite}=z.object({favorite:z.boolean()}).parse(req.body);const favorites=mutateStore(s=>{if(!s.metrics.some(m=>m.id===req.params.id))throw new Error('指标不存在');s.favorites=(s.favorites||[]).filter(id=>id!==req.params.id);if(favorite)s.favorites.push(req.params.id);return s.favorites;});res.json({favorites});}));
app.post('/api/metrics',route(saveMetric)); app.put('/api/metrics/:id',route(saveMetric));
app.delete('/api/metrics/:id',route(async(req,res)=>{mutateStore(s=>{s.metrics=s.metrics.filter(m=>m.id!==req.params.id);s.favorites=(s.favorites||[]).filter(id=>id!==req.params.id);});res.json({ok:true});}));
app.put('/api/settings',route(async(req,res)=>{
  const data=z.object({model:z.string().trim().min(1).max(100),baseUrl:z.url(),apiKey:z.string().max(500).optional()}).parse(req.body);
  const u=new URL(data.baseUrl); if(u.protocol!=='https:' || u.username || u.password || u.search || u.hash) throw new Error('模型地址必须为无凭据和查询参数的 HTTPS URL');
  mutateStore(s=>{s.settings.model=data.model;s.settings.baseUrl=data.baseUrl.replace(/\/$/,'');if(data.apiKey?.trim())s.settings.apiKey=data.apiKey.trim();});res.json(publicSettings());
}));
app.post('/api/settings/test',route(async(_req,res)=>{const start=Date.now();const result=await callModel([{role:'user',content:'只返回 JSON: {"ok":true}'}]);if(result.ok!==true)throw new Error('模型响应不符合预期');res.json({ok:true,latency:Date.now()-start,model:publicSettings().model});}));
app.post('/api/analyze',route(async(req,res)=>{
  const data=z.object({query:z.string().trim().min(2).max(3000),messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(15000)})).max(30).default([])}).parse(req.body);
  res.json(await analyzeWithModel(data.query,data.messages));
}));
app.post('/api/confirm',route(async(req,res)=>{
  const s=readStore();const requestId=req.body.requestId?z.string().uuid().parse(req.body.requestId):null;const requestFingerprint=createHash('sha256').update(JSON.stringify({metricId:req.body.metricId,revision:req.body.revision,definition:req.body.definition,request:req.body.request||''})).digest('hex');const prior=requestId?s.queries.find(q=>q.requestId===requestId):null;if(prior){if(prior.requestFingerprint!==requestFingerprint)throw new Error('本次保存标识对应其他条件，请重新确认');res.json(prior);return;}const metric=s.metrics.find(m=>m.id===req.body.metricId);if(!metric) throw new Error('请先选择或配置指标');
  if(req.body.revision!==metric.revision) throw new Error('指标定义已更新，请重新分析并确认');
  const source=await getSource(metric.source),built=buildQuery(metric,source,req.body.definition||{});
  const fieldLabel=name=>source.columns.find(c=>c.name===name)?.businessLabel||name;
  const scopeText=[...metric.filters,...built.definition.scopeFilters].map(f=>`${fieldLabel(f.field)} ${{eq:'等于',ne:'不等于',gt:'大于',gte:'大于等于',lt:'小于',lte:'小于等于',in:'属于',not_null:'有值',is_null:'为空'}[f.operator]} ${Array.isArray(f.value)?f.value.join('、'):f.value??''}`).join('；');
  const summary=`${metric.name}：${metric.description}；${built.definition.startDate} 至 ${inclusiveEnd(built.definition.endDate)}（包含起止日），按 ${fieldLabel(built.definition.timeField)} 归属，${{total:'合计',day:'按天',week:'按周',month:'按月'}[built.definition.grain]}${built.definition.dimension?'，按 '+fieldLabel(built.definition.dimension)+' 分组':''}。范围：${scopeText||'全部数据'}。`;
  const query={id:randomUUID(),requestId,requestFingerprint,name:metric.name,createdAt:new Date().toISOString(),metric:structuredClone(metric),sourceSnapshot:source,...built,summary,request:String(req.body.request||'').slice(0,3000)};
  const saved=mutateStore(s=>{const existing=requestId?s.queries.find(q=>q.requestId===requestId):null;if(existing){if(existing.requestFingerprint!==requestFingerprint)throw new Error('保存条件已变化，请重新确认');return existing;}if(s.metrics.find(m=>m.id===metric.id)?.revision!==metric.revision)throw new Error('指标定义已更新，请重新选择指标后确认');s.queries.unshift(query);s.queries=s.queries.slice(0,200);return query;});res.json(saved);
}));
app.patch('/api/queries/:id',route(async(req,res)=>{
 const input=z.object({name:z.string().trim().min(1).max(100)}).parse(req.body);
 const query=mutateStore(s=>{const q=s.queries.find(q=>q.id===req.params.id);if(!q)throw new Error('查询记录不存在');q.name=input.name;return q;});res.json(query);
}));
app.delete('/api/queries/:id',route(async(req,res)=>{mutateStore(s=>{s.queries=s.queries.filter(q=>q.id!==req.params.id);});res.json({ok:true});}));
app.post('/api/queries/:id/evidence',route(async(req,res)=>res.json(await resultEvidence(req.params.id,req.body))));
app.post('/api/queries/:id/run',route(async(req,res)=>{
  const query=readStore().queries.find(q=>q.id===req.params.id);if(!query) throw new Error('查询记录不存在');
  assertMarketingSource(query.metric.source);
  const mode=z.enum(['full','sample']).parse(req.body.mode);
  const pool=getPool();if(!pool) throw new Error('数据库未连接，无法执行真实查询');
  const params=[...query.params];
  if(mode==='sample')params[1]=new Date(Date.parse(query.definition.startDate)+86400000).toISOString().slice(0,10);
  if(params[1]>query.definition.endDate)params[1]=query.definition.endDate;
  const connection=await pool.getConnection();
  let reusable=true;
  try {
    await connection.query('SET SESSION MAX_EXECUTION_TIME=12000');
    await connection.query('START TRANSACTION READ ONLY');
    const started=Date.now();
    const [allRows]=await connection.execute({sql:query.sql,timeout:14000},params);
    res.json({...resultSummary(allRows.slice(0,500)),aggregation:query.metric.aggregation,truncated:allRows.length>500,mode,start:params[0],end:params[1],elapsed:Date.now()-started,unit:query.metric.unit,sql:query.displaySql,sampleUnit:'day'});
  } catch(error){if(error.code==='PROTOCOL_SEQUENCE_TIMEOUT'||error.fatal){reusable=false;connection.destroy();}throw error;} finally { if(reusable){try { await connection.rollback(); } finally { connection.release(); }} }
}));
app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
app.use(express.static(path.join(root,'public'),{etag:false,maxAge:0}));
app.use((error,_req,res,_next)=>{const message=error instanceof z.ZodError?'提交内容不完整或格式错误：'+error.issues.map(i=>i.path.join('.')+' '+i.message).join('；'):error.code==='ER_QUERY_TIMEOUT'||error.code==='PROTOCOL_SEQUENCE_TIMEOUT'?'查询超过 12 秒，请缩短日期范围或仅试跑开始日':error.message||'请求失败';res.status(400).json({error:message});});
