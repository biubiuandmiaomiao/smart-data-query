import { getPool } from './db.js';
import { readStore, mutateStore } from './store.js';
import { MARKETING_DATABASE, assertMarketingSource, fieldSemantics, sourceSemantics } from './policy.js';
let tableCache;
export async function listTables(refresh=false) {
  if(!refresh&&tableCache&&Date.now()-tableCache.at<60000)return structuredClone(tableCache.rows);
  const pool = getPool(); if (!pool) throw new Error('数据库未配置，请配置 .env 后重启服务');
  const [rows] = await pool.execute("SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, TABLE_COMMENT AS comment, TABLE_ROWS AS estimatedRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE','VIEW') ORDER BY TABLE_NAME", [MARKETING_DATABASE]);
  const result = rows.filter(r=>!/_bak_|_backup_|schema_migration|cursor|quarantine/i.test(r.tableName)).map(r => ({ ...r, id: `${r.schemaName}.${r.tableName}` }));
  tableCache={at:Date.now(),rows:result};return structuredClone(result);
}
export async function getSource(id, refresh = false) {
  const parts = assertMarketingSource(id);
  const cached = readStore().sources[id]; if (cached?.metadataVersion === 3 && !refresh) return decoratedSource(cached);
  const pool = getPool(); if (!pool) throw new Error('数据库未配置');
  const [columns] = await pool.execute('SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_COMMENT AS comment, IS_NULLABLE AS nullable, COLUMN_KEY AS keyType FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', parts);
  if (!columns.length) throw new Error('表不存在或当前账号无权访问');
  const [indexes] = await pool.execute('SELECT INDEX_NAME AS name, COLUMN_NAME AS field, SEQ_IN_INDEX AS position, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_TYPE = ?', [...parts, 'BTREE']);
  const [[table]] = await pool.execute('SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', parts);
  const source = { id, columns, indexes, comment: table?.comment || '', metadataVersion: 3, syncedAt: new Date().toISOString() }; mutateStore(s => { s.sources[id] = source; }); return decoratedSource(source);
}
export function decoratedSource(source) { const annotations = readStore().fields; return { ...source, semantics: sourceSemantics(source), columns: source.columns.map(c => fieldSemantics(c, annotations[`${source.id}.${c.name}`])) }; }
