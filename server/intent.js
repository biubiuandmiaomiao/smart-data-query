import { z } from 'zod';
import { isoDate } from './sql-builder.js';

const scalar = z.union([z.string().max(1000), z.number().int().safe(), z.boolean()]);
export const scopeFilterSchema = z.object({
  field: z.string().min(1), operator: z.enum(['eq','ne','in','gt','gte','lt','lte','not_null','is_null']),
  value: z.union([scalar, z.array(scalar).min(1).max(50)]).default('')
}).superRefine((f, ctx) => {
  if ((f.operator === 'in') !== Array.isArray(f.value)) ctx.addIssue({ code:'custom', message:'列表范围须使用 in 运算符' });
  if (!['not_null','is_null'].includes(f.operator) && f.value === '') ctx.addIssue({ code:'custom', message:'范围值不能为空' });
});
const intentSchema = z.object({
  summary:z.string().min(1).max(6000), metricId:z.string().nullable().default(null),
  startDate:z.string().nullable().default(''), endDate:z.string().nullable().default(''),
  grain:z.enum(['day','week','month','total']).default('total'),
  timeField:z.string().nullable().default(''), dimension:z.string().nullable().default(''),
  scopeFilters:z.array(scopeFilterSchema).max(20).default([]),
  questions:z.array(z.object({question:z.string().min(1),options:z.array(z.string()).max(6).default([])})).max(8).default([]),
  suggestedMetric:z.record(z.string(),z.unknown()).nullable().default(null)
});

export function validateIntent(raw, metrics, sources) {
  const parsed=intentSchema.safeParse(raw);
  if(!parsed.success) throw new Error('模型返回的条件格式不完整，请补充说明或重新分析；未生成替代口径');
  const result=parsed.data;
  result.startDate ||= ''; result.endDate ||= ''; result.dimension ||= ''; result.timeField ||= '';
  for(const date of [result.startDate,result.endDate]) if(date)isoDate(date);
  if(result.startDate&&result.endDate&&result.startDate>=result.endDate)throw new Error('模型返回的结束日期必须晚于开始日期');
  const metric=metrics.find(m=>m.id===result.metricId);
  if(result.metricId&&!metric)throw new Error('模型引用了不存在的指标，请重新分析');
  if(metric){
    const source=sources.find(s=>s.id===metric.source);
    if(!source)throw new Error('所选指标的表结构未加载，请同步字段后重试');
    const requireRole=(name,roles)=>{
      const field=source.columns.find(c=>c.name===name);
      if(!field||!roles.includes(field.role)||field.sensitivity==='restricted')throw new Error(`模型字段「${name}」不适用于当前指标，请补充业务说明；不会自动替换字段`);
    };
    result.timeField ||= metric.timeField;
    requireRole(result.timeField,['time']);
    if(result.dimension)requireRole(result.dimension,['scope']);
    for(const f of result.scopeFilters)requireRole(f.field,['scope','time']);
    result.metricRevision=metric.revision;
  }
  if(result.suggestedMetric){
    const source=sources.find(s=>s.id===result.suggestedMetric.source);
    if(!source)throw new Error('建议指标没有可验证的营销数据来源，请补充表名后重试');
    result.suggestedMetric={...result.suggestedMetric,status:'draft'};
  }
  return {...result,modelUsed:true};
}

export function selectRelevantSources(query, metrics, tables, limit=8){
  const text=query.toLowerCase();
  const providers=[[/adq/i,'adq_'],[/\bad\b/i,'ocean_ad_'],[/千川/,'qianchuan_'],[/快手|金牛|磁力/,'jinniu_'],[/微信|视频号/,'wechat'],[/天猫|淘宝/,'tmall_']];
  const prefixes=providers.filter(([re])=>re.test(query)).map(([,prefix])=>prefix);
  const terms=[...new Set(query.match(/[a-zA-Z_]{3,}|千川|投放|消耗|曝光|点击|直播|素材|账户|计划|微信|快手|天猫|部门/g)||[])];
  const ranked=tables.map(t=>({id:t.id,score:
    (prefixes.some(p=>t.tableName.startsWith(p))?40:0)+
    terms.reduce((n,k)=>n+(`${t.comment} ${t.tableName}`.toLowerCase().includes(k.toLowerCase())?2:0),0)+
    (Number(t.estimatedRows)>0?1:0)
  })).filter(t=>t.score>1).sort((a,b)=>b.score-a.score);
  const exact=metrics.filter(m=>[m.name,...(m.aliases||[])].some(n=>n&&text.includes(n.toLowerCase()))).map(m=>m.source);
  return [...new Set([...exact,...ranked.slice(0,4).map(t=>t.id),...metrics.map(m=>m.source)])].slice(0,limit);
}
