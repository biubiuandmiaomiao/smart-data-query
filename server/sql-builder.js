import mysql from 'mysql2';
import { assertMarketingSource, fieldSemantics, sourceSemantics } from './policy.js';
export function identifier(name){if(!/^[a-zA-Z0-9_]+$/.test(name||''))throw new Error('无效的字段或表名');return '`'+name+'`';}
export function isoDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('请输入有效日期 YYYY-MM-DD');return value;}
const ops={eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='};
function fieldsFor(source){return new Map(source.columns.map(c=>[c.name,c.role?c:fieldSemantics(c)]));}
function validateFilter(f,fields,scopeOnly=false){
 const c=fields.get(f.field);if(!c)throw new Error(`筛选字段不存在：${f.field}`);
 const values=Array.isArray(f.value)?f.value:[f.value];
 if(values.some(v=>typeof v==='number'&&!Number.isSafeInteger(v)))throw new Error('范围编码请使用文本，避免大整数或小数被错误转换');
 if(scopeOnly&&!['scope','time'].includes(c.role))throw new Error(`${f.field} 不是范围字段；请在数值计算区配置度量`);
 if(!['scope','time'].includes(c.role))throw new Error(`${f.field} 不是范围条件字段`);
 if(!['eq','ne','gt','gte','lt','lte','not_null','is_null','in'].includes(f.operator))throw new Error('无效的筛选条件');
 if(f.operator==='in'){if(!Array.isArray(f.value)||!f.value.length||f.value.length>50||f.value.some(v=>typeof v!=='string'&&typeof v!=='number'))throw new Error('范围列表须为1至50个值');}
 else if(!['not_null','is_null'].includes(f.operator)&&(f.value===''||f.value==null||!['string','number','boolean'].includes(typeof f.value)))throw new Error('请填写有效的筛选值');
}
export function validateMetric(metric,source){
 assertMarketingSource(metric.source);if(metric.source!==source.id)throw new Error('指标与数据表不匹配');
 const fields=fieldsFor(source),field=name=>{if(!fields.has(name))throw new Error(`字段不存在：${name}`);return fields.get(name);};
 if(!metric.name?.trim()||!metric.description?.trim())throw new Error('请填写指标名称和业务定义');
 if(!['sum','avg','min','max','count','count_distinct','ratio','ratio_of_sums'].includes(metric.aggregation))throw new Error('不支持的计算方式');
 if(!(Number(metric.scale)>0)||!Number.isFinite(Number(metric.scale)))throw new Error('单位换算除数必须大于0');
 if(!(Number(metric.multiplier??1)>0)||!Number.isFinite(Number(metric.multiplier??1)))throw new Error('输出倍数必须大于0');
 if(field(metric.timeField).role!=='time')throw new Error('时间依据必须是业务时间，不能用采集或更新时间');
 if(metric.dimension&&field(metric.dimension).role!=='scope')throw new Error('分组只能选择范围字段，不能选择消耗、曝光等数值');
 const measure=name=>{const c=field(name);if(c.role!=='measure'||!/int|decimal|float|double|numeric/i.test(c.type))throw new Error(`${name} 不是可聚合的数值度量；ID、比率、余额不能直接求和`);};
 if(!metric.aggregation.startsWith('count'))measure(metric.valueField);
 if(metric.aggregation==='ratio_of_sums')measure(metric.denominatorField);
 if(['count_distinct','ratio'].includes(metric.aggregation)){if(!metric.distinctFields?.length)throw new Error('请选择去重键');metric.distinctFields.forEach(f=>{if(field(f).role!=='scope')throw new Error('去重键必须是账户、计划等范围标识');});}
 for(const f of metric.filters||[])validateFilter(f,fields);
 const sem=source.semantics||sourceSemantics(source);
 if(sem.kind==='snapshot'&&metric.status==='active'&&(metric.snapshotPolicy!=='latest_per_day'||!sem.snapshotField||!sem.partitionKeys.includes(metric.timeField)))throw new Error('此表包含多次快照：须选择按业务粒度取每日最新快照；无法识别包含业务日期的唯一键时需先整理日表');
 return metric;
}
export function buildQuery(metric,source,input){
 validateMetric(metric,source);if(metric.status!=='active')throw new Error('该指标尚为草稿，请完善并启用');
 const startDate=isoDate(input.startDate),endDate=isoDate(input.endDate);if(startDate>=endDate)throw new Error('结束日期必须晚于开始日期');
 const grain=input.grain||'total';if(!['total','day','week','month'].includes(grain))throw new Error('无效的统计粒度');
 const fields=fieldsFor(source),time=input.timeField||metric.timeField,dim=input.dimension===undefined?metric.dimension:input.dimension;
 if(fields.get(time)?.role!=='time')throw new Error('时间字段必须是业务时间');
 if(dim&&fields.get(dim)?.role!=='scope')throw new Error('分组必须使用范围字段');
 const scopeFilters=input.scopeFilters||[];
 if(!Array.isArray(scopeFilters)||scopeFilters.length>20)throw new Error('最多设置20个范围条件');
 scopeFilters.forEach(f=>validateFilter(f,fields,true));
 if(input.dimensionValues?.length)throw new Error('请使用独立的范围条件，不要将筛选值绑定到分组字段');
 const ref=x=>`t.${identifier(x)}`,value=metric.aggregation.startsWith('count')?null:ref(metric.valueField);
 const count=`COUNT(DISTINCT ${(metric.distinctFields||[]).map(ref).join(', ')})`;
 const den=metric.aggregation==='ratio_of_sums'?ref(metric.denominatorField):null;
 const expressions={count:'COUNT(*)',count_distinct:count,sum:`SUM(${value})`,avg:`AVG(${value})`,min:`MIN(${value})`,max:`MAX(${value})`,ratio:`CAST(SUM(${value}) AS DECIMAL(38,12)) / NULLIF(${count}, 0)`,ratio_of_sums:`CAST(SUM(${value}) AS DECIMAL(38,12)) / NULLIF(SUM(${den}), 0)`};
 const expression=expressions[metric.aggregation];
 const measure=metric.aggregation.startsWith('count')?expression:`ROUND((${expression}) / ${Number(metric.scale)} * ${Number(metric.multiplier??1)}, 6)`;
 const select=[],groups=[];
 if(grain!=='total'){const period=grain==='week'?`DATE_FORMAT(DATE_SUB(${ref(time)}, INTERVAL WEEKDAY(${ref(time)}) DAY), '%Y-%m-%d')`:`DATE_FORMAT(${ref(time)}, '${grain==='month'?'%Y-%m-01':'%Y-%m-%d'}')`;select.push(`${period} AS period`);groups.push('period');}
 if(dim){select.push(`${ref(dim)} AS dimension`);groups.push('dimension');}select.push(`${measure} AS value`);select.push('COUNT(*) AS _matchedRows');
 const params=[startDate,endDate],where=[];
 const sem=source.semantics||sourceSemantics(source),table=metric.source.split('.').map(identifier).join('.');
 let from=`${table} AS t`;
 if(sem.kind==='snapshot'){
   if(!sem.partitionKeys.includes(time))throw new Error('快照查询必须按其业务日期字段归属');
   from=`(\n  SELECT src.*, ROW_NUMBER() OVER (PARTITION BY ${sem.partitionKeys.map(identifier).join(', ')} ORDER BY ${identifier(sem.snapshotField)} DESC) AS _snapshot_rank\n  FROM ${table} AS src\n  WHERE ${identifier(time)} >= ? AND ${identifier(time)} < ?\n) AS t`;
   where.push('t._snapshot_rank = 1');
 }else{
   where.push(`${ref(time)} >= ?`,`${ref(time)} < ?`);
   const idx=(source.indexes||[]).find(i=>i.position===1&&i.field===time);
   if(idx&&Date.parse(endDate)-Date.parse(startDate)<=7*86400000)from+=` FORCE INDEX (${identifier(idx.name)})`;
 }
 for(const f of [...(metric.filters||[]),...scopeFilters]){
   if(['not_null','is_null'].includes(f.operator))where.push(`${ref(f.field)} IS ${f.operator==='not_null'?'NOT ':''}NULL`);
   else if(f.operator==='in'){where.push(`${ref(f.field)} IN (${f.value.map(()=>'?').join(', ')})`);params.push(...f.value);}
   else{where.push(`${ref(f.field)} ${ops[f.operator]} ?`);params.push(f.value);}
 }
 const sql=[`SELECT /*+ MAX_EXECUTION_TIME(12000) */\n  ${select.join(',\n  ')}`,`FROM ${from}`,`WHERE ${where.join('\n  AND ')}`,groups.length?`GROUP BY ${groups.join(', ')}\nORDER BY ${groups.join(', ')}`:'','LIMIT 501'].filter(Boolean).join('\n');
 return {sql,params,displaySql:mysql.format(sql,params),definition:{startDate,endDate,grain,timeField:time,dimension:dim,scopeFilters,snapshotPolicy:metric.snapshotPolicy||'none'}};
}
