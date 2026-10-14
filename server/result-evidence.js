import {readStore} from './store.js';
import {loadEvidence} from './evidence.js';
import {isoDate} from './sql-builder.js';
import {shiftDate} from '../public/workflow.js';
export function drilldownInput(query,input){
 const d=query.definition,metric=query.metric;const mode=input.mode||'full';if(!['full','sample'].includes(mode))throw new Error('无效的查询方式');
 let start=d.startDate,end=mode==='sample'?shiftDate(start,1):d.endDate;if(end>d.endDate)end=d.endDate;
 if(d.grain!=='total'){isoDate(input.period);let periodEnd;if(d.grain==='day')periodEnd=shiftDate(input.period,1);else if(d.grain==='week')periodEnd=shiftDate(input.period,7);else{const date=new Date(input.period+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1,1);periodEnd=date.toISOString().slice(0,10);}start=start>input.period?start:input.period;end=end<periodEnd?end:periodEnd;if(start>=end)throw new Error('所选日期不在这次分析范围内');}
 const filters=[...(metric.filters||[]),...(d.scopeFilters||[])];
 if(d.dimension){if(!Object.hasOwn(input,'dimension')||(input.dimension!==null&&typeof input.dimension!=='string'&&typeof input.dimension!=='number'))throw new Error('请选择要核对的分组');if(typeof input.dimension==='number'&&!Number.isSafeInteger(input.dimension))throw new Error('分组编号必须按原始文本传入');filters.push(input.dimension===null?{field:d.dimension,operator:'is_null'}:{field:d.dimension,operator:'eq',value:String(input.dimension)});}
 const fields=[...new Set([metric.valueField,metric.denominatorField,d.dimension,d.timeField,...(metric.distinctFields||[])].filter(Boolean))].slice(0,6);
 return {source:metric.source,fields,startDate:start,endDate:end,timeField:d.timeField,scopeFilters:filters};
}
export async function resultEvidence(id,input){const query=readStore().queries.find(q=>q.id===id);if(!query)throw new Error('分析记录不存在');const data=await loadEvidence(drilldownInput(query,input));return {...data,analysisName:query.name,metricRevision:query.metric.revision,note:`依据已保存的指标 v${query.metric.revision} 与选中结果的范围取样。${data.note} 样例用于核对字段，不用于复算完整结果。`};}
