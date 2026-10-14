import { businessGuide } from './business-guide.js';
export const MARKETING_DATABASE = 'd_root_project_marketing_db';
export function assertMarketingSource(id) {
  const parts = String(id || '').split('.');
  if (parts.length !== 2 || parts[0] !== MARKETING_DATABASE || !/^[a-zA-Z0-9_]+$/.test(parts[1])) throw new Error('此工作台仅允许访问数据库 d_root_project_marketing_db');
  if (/(_bak_|_backup_|schema_migration|cursor|quarantine)/i.test(parts[1])) throw new Error('备份或系统控制表不作为数据分析来源');
  return parts;
}
export const roleNames = { scope: '范围条件', time: '业务时间', measure: '数值度量', derived: '派生比率', snapshot: '时点数值', technical: '技术字段' };
export function inferField(c) {
  const name=c.name.toLowerCase(),text=c.comment||'',numeric=/int|decimal|float|double|numeric/i.test(c.type);
  const ratioName=name.replace(/_for_(?:overall_)?roi2(?:_1h)?/g,'');
  let role='technical',reason='采集追溯或尚未确认的字段，不参与指标计算';
  if (/^(id|created_at|updated_at|collected_at|observed_at|collection_time|stat_time|snapshot_time|snapshot_at)$/.test(name)||/raw_data|request_id|batch|parser_version|_json$|source_api|app_id/.test(name)||/json|blob|text/i.test(c.type)) {}
  else if (/date|timestamp|datetime/i.test(c.type)) {role='time';reason='决定统计日期范围和趋势归属';}
  else if (/(^|_)(id|code)(_|$)/.test(name)||/账户.*ID|计划.*ID|项目.*ID|单元.*ID/.test(text)) {role='scope';reason='业务标识，用于筛选或分组；数字编码不代表可加总数值';}
  else if (/balance|余额|存量/.test(name+' '+text)) {role='snapshot';reason='时点余额或存量，不能跨日期相加';}
  else if (numeric&&(/(_roi|^roi|_rate|_percent|^ctr$|^cpm|^cpc|^cpa|cost_per_)/.test(ratioName)||/点击率|转化率|退款率|结算率|ROI|千次|均价|客单价|单位成本|订单成本|问询成本|获客成本|转化成本|点击成本|成本.*除以|消耗除以|成本.*消耗\//i.test(text)||/(?:a3|convert|effective)_cost/.test(name))) {role='derived';reason='比率或单位成本；汇总后应重新用分子 ÷ 分母计算';}
  else if (/(^|_)(name|status|type|channel|platform|goal|action|topic|tag|alias|department)(_|$)/.test(name)||/部门|标签|营销目标|优化目标/.test(text)||/char|enum/i.test(c.type)) {role='scope';reason='用于筛选或分组；即使存储为数字，也不是可加总的业务量';}
  else if(numeric&&/cost|amount|gmv|count|cnt|num|quantity|revenue|消耗|花费|金额|次数|点击|曝光|展示|订单数|转化数|获客|佣金|补贴/.test(name+' '+text)){role='measure';reason='业务金额或数量，可在已确认的数据粒度内聚合';}
  return {role,roleReason:reason,unit:!['measure','derived','snapshot'].includes(role)?'':/_yuan|单位.?元|[（(]元[）)]/.test(name+' '+text)?'元':role==='derived'&&/percent|百分|率/.test(name+' '+text)?'%':/(?:^|_)(?:count|cnt)(?:_|\s|$)|次数|数量/.test(name+' '+text)?'次':'',label:text.split(/[；;]/)[0]||c.name};
}
export function fieldSemantics(c, annotation = {}) {
  const inferred = inferField(c);
  const role = annotation.role || inferred.role;
  return { ...c, ...inferred, ...annotation, ...businessGuide({...c,...inferred,role},annotation), role, roleReason: annotation.role && annotation.role !== inferred.role ? '业务管理员已调整字段用途' : inferred.roleReason };
}
export function sourceSemantics(source) {
  const keys = source.indexes || [];
  const uniqueNames = [...new Set(keys.filter(i => Number(i.nonUnique) === 0 && i.name !== 'PRIMARY').map(i => i.name))];
  const uniqueKeys = uniqueNames.map(name => keys.filter(i=>i.name===name).sort((a,b)=>a.position-b.position).map(i=>i.field));
  const snapshotNames = ['collection_time','stat_time','snapshot_time','snapshot_at'];
  const snapshotKey = uniqueKeys.find(k=>k.some(f=>snapshotNames.includes(f)));
  const cumulative = Boolean(snapshotKey || /累计|每小时|每半小时|每五分钟/.test(source.comment || '') || /hourly|halfhour|half_hour|timeslot|_snapshot/.test(source.id));
  return { kind: cumulative ? 'snapshot' : 'daily', grainKeys: uniqueKeys[0] || [], snapshotField: snapshotKey?.find(f=>snapshotNames.includes(f)) || '', partitionKeys: snapshotKey?.filter(f=>!snapshotNames.includes(f)) || [], note: cumulative ? '多次采集快照，须先按业务粒度选取每日最新一条，再汇总数值。' : '按业务日期记录的明细；按唯一键确认一行代表什么，再汇总数值。' };
}
