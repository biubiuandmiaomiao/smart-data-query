import { getSource } from './schema.js';
import { getPool } from './db.js';
import { identifier } from './sql-builder.js';
import { assertMarketingSource } from './policy.js';

export function valuesQuery(source, fieldName){
  assertMarketingSource(source.id);
  const field=source.columns.find(c=>c.name===fieldName);
  if(!field||field.role!=='scope'||field.sensitivity==='restricted')throw new Error('仅可查看普通范围字段的取值候选');
  const fieldSql=identifier(field.name);
  const tableSql=source.id.split('.').map(identifier).join('.');
  return `SELECT /*+ MAX_EXECUTION_TIME(4000) */ DISTINCT ${fieldSql} AS value FROM (SELECT ${fieldSql} FROM ${tableSql} LIMIT 1000) AS sample WHERE ${fieldSql} IS NOT NULL LIMIT 51`;
}
export async function fieldValues(sourceId,fieldName){
  const source=await getSource(sourceId),sql=valuesQuery(source,fieldName);
  const pool=getPool();if(!pool)throw new Error('数据库尚未连接');
  const [rows]=await pool.execute({sql,timeout:5000});
  return {values:rows.slice(0,50).map(r=>String(r.value)),labels:source.columns.find(c=>c.name===fieldName)?.valueLabels||{},sampled:true,truncated:rows.length>50,note:'候选值来自最多1000条记录的样本，不代表全部取值；可手动输入其他值。'};
}
