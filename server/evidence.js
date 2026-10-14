import {inclusiveEnd} from '../public/workflow.js';
import {scopeFilterSchema} from './intent.js';
import {readStore} from './store.js';
import {randomUUID} from 'node:crypto';
import {getSource} from './schema.js';
import {getPool} from './db.js';
import {identifier,isoDate} from './sql-builder.js';
import {assertMarketingSource} from './policy.js';
import {fieldSignature} from './business-guide.js';
const receipts=new Map();
export function buildEvidenceQuery(source,input){
 assertMarketingSource(source.id);
 if(!Array.isArray(input.fields)||!input.fields.length||input.fields.length>6)throw new Error('请选择1至6个需要核对的字段');
 const allowed=c=>c.sensitivity!=='restricted'&&!/json|blob|text/i.test(c.type);
 const picked=[...new Set(input.fields)].map(name=>{const c=source.columns.find(c=>c.name===name);if(!c||!allowed(c))throw new Error('字段不存在、受限或不适合展示原始值');return c;});
 const context=source.columns.filter(c=>allowed(c)&&!picked.some(p=>p.name===c.name)&&(c.role==='time'||/(advertiser|account|plan)_name$/.test(c.name))).sort((a,b)=>{const rank=c=>c.role==='time'?0:['advertiser_name','account_name','plan_name'].includes(c.name)?1:2;return rank(a)-rank(b);}).slice(0,4);
 const columns=[...context,...picked];const params=[];let where='';
 if(input.startDate||input.endDate){isoDate(input.startDate);isoDate(input.endDate);if(input.startDate>=input.endDate)throw new Error('结束日期必须晚于开始日期');const time=source.columns.find(c=>c.name===input.timeField&&c.role==='time'&&allowed(c));if(!time)throw new Error('请选择有效的业务日期');where=` WHERE ${identifier(time.name)} >= ? AND ${identifier(time.name)} < ?`;params.push(input.startDate,input.endDate);}
 const filters=input.scopeFilters||[];if(!Array.isArray(filters)||filters.length>40)throw new Error('筛选条件过多');
 for(const raw of filters){const f=scopeFilterSchema.parse(raw);const c=source.columns.find(c=>c.name===f.field);if(!c||!['scope','time'].includes(c.role)||!allowed(c))throw new Error('筛选字段不适用于此数据表');const col=identifier(c.name);let condition;if(f.operator==='in'){condition=`${col} IN (${f.value.map(()=>'?').join(',')})`;params.push(...f.value);}else if(['is_null','not_null'].includes(f.operator)){condition=col+(f.operator==='is_null'?' IS NULL':' IS NOT NULL');}else{condition=col+' '+({eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='}[f.operator])+' ?';params.push(f.value);}where+=(where?' AND ':' WHERE ')+condition;}
 return {sql:`SELECT /*+ MAX_EXECUTION_TIME(5000) */ ${columns.map(c=>identifier(c.name)).join(', ')} FROM ${source.id.split('.').map(identifier).join('.')} ${where} LIMIT 20`,params,columns};
}
export async function loadEvidence(input){
 if(input.metricId){const metric=readStore().metrics.find(m=>m.id===input.metricId);if(!metric||metric.source!==input.source)throw new Error('指标来源不匹配');input={...input,scopeFilters:[...(metric.filters||[]),...(input.scopeFilters||[])]};}
 const source=await getSource(input.source),built=buildEvidenceQuery(source,input);const pool=getPool();if(!pool)throw new Error('数据库未连接，暂时无法核对真实数据');
 const [rows]=await pool.execute({sql:built.sql,timeout:6500,dateStrings:true},built.params);
 const sampledAt=new Date().toISOString();const evidenceId=randomUUID();
 for(const [key,item] of receipts)if(Date.now()-item.at>1800000)receipts.delete(key);
 if(receipts.size>=200)receipts.delete(receipts.keys().next().value);
 receipts.set(evidenceId,{source:source.id,at:Date.now(),hasRows:rows.length>0,fields:Object.fromEntries(built.columns.map(c=>[c.name,fieldSignature(c)]))});
 const safeRows=rows.map(row=>Object.fromEntries(built.columns.map(c=>[c.name,row[c.name]===null?null:String(row[c.name])])));
 return {source:source.id,columns:built.columns,requestedFields:input.fields,rows:safeRows,evidenceId,sampledAt,scope:input.startDate?`${input.startDate} 至 ${inclusiveEnd(input.endDate)}（包含起止日）`:'未限制日期',filters:input.scopeFilters||[],filterLabels:Object.fromEntries((input.scopeFilters||[]).map(f=>[f.field,source.columns.find(c=>c.name===f.field)?.businessLabel||f.field])),note:'最多展示20条原始记录，未排序，不代表最新数据或统计结果；按上方显示的日期和筛选条件取样。空值表示未记录，0表示记录值为零。',snapshot:source.semantics?.kind==='snapshot'};
}
export function requireEvidence(id,source,column){const receipt=receipts.get(id);if(!receipt||Date.now()-receipt.at>1800000||!receipt.hasRows||receipt.source!==source||receipt.fields[column.name]!==fieldSignature(column))throw new Error('请先重新查看此字段的真实数据，再确认业务含义');}
