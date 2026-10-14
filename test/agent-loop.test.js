import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectExamples } from '../server/examples.js';

// Isolate the real store so the module-load side effects (workspace.json) never touch shared state.
const dir = mkdtempSync(path.join(tmpdir(), 'marketing-loop-test-'));
process.env.DATA_DIR = dir;
const { analyzeWithModel } = await import('../server/agent.js');
after(() => rmSync(dir, { recursive: true, force: true }));

const SOURCE_ID = 'd_root_project_marketing_db.ocean_ad_delivery_daily_detail';
const source = {
  id: SOURCE_ID,
  comment: 'AD日投放明细',
  semantics: { kind: 'daily', grainKeys: [], snapshotField: '', partitionKeys: [] },
  indexes: [],
  columns: [
    { name: 'stat_date', type: 'date', role: 'time', sensitivity: 'normal', businessLabel: '业务日期', unit: '', businessExplanation: '投放日期', meaningStatus: 'confirmed' },
    { name: 'advertiser_name', type: 'varchar(128)', role: 'scope', sensitivity: 'normal', businessLabel: '广告账户名称', unit: '', businessExplanation: '账户名称', meaningStatus: 'confirmed' },
    { name: 'stat_cost', type: 'decimal(20,6)', role: 'measure', sensitivity: 'normal', businessLabel: '投放消耗', unit: '元', businessExplanation: '消耗', meaningStatus: 'confirmed' },
  ],
};
const metric = {
  id: 'ad_spend', revision: 1, name: 'AD投放消耗', description: '消耗求和', aliases: ['AD消耗'],
  source: SOURCE_ID, status: 'active', aggregation: 'sum', valueField: 'stat_cost', denominatorField: '',
  timeField: 'stat_date', dimension: '', scale: 1, multiplier: 1, unit: '元', owner: '营销',
  filters: [], distinctFields: [], snapshotPolicy: 'none',
};
const tables = [{ id: SOURCE_ID, tableName: 'ocean_ad_delivery_daily_detail', comment: 'AD日投放明细', estimatedRows: 1000 }];
const validIntent = {
  summary: '按账户看AD消耗', metricId: 'ad_spend', startDate: '2026-10-01', endDate: '2026-10-08',
  grain: 'day', timeField: 'stat_date', dimension: 'advertiser_name', scopeFilters: [], questions: [], suggestedMetric: null,
};

function fakeStore() {
  return {
    metrics: [metric],
    sources: { [SOURCE_ID]: source },
    queries: [
      {
        id: 'q1', request: '统计最近7个完整日的AD投放消耗，按广告账户看', name: 'AD投放消耗',
        summary: 'AD投放消耗：2026-10-01 至 2026-10-07，按天，按 广告账户名称 分组。',
        metric,
        definition: { startDate: '2026-10-01', endDate: '2026-10-08', grain: 'day', timeField: 'stat_date', dimension: 'advertiser_name', scopeFilters: [] },
      },
      {
        id: 'q2', request: 'ADQ净成交ROI按部门', name: 'ADQ净成交ROI', summary: 'ADQ净成交ROI',
        metric: { ...metric, id: 'adq_net_roi', source: 'd_root_project_marketing_db.adq_account_daily_databoard' },
        definition: { startDate: '2026-10-01', endDate: '2026-10-08', grain: 'total', timeField: 'report_date', dimension: 'department', scopeFilters: [] },
      },
    ],
  };
}

function depsFor(store, callModel) {
  return {
    listTables: async () => tables,
    getSource: async () => source,
    readStore: () => store,
    callModel,
  };
}

test('selectExamples 按关键词相似度排序并保留相关历史', () => {
  const examples = selectExamples('AD消耗 按账户看', fakeStore().queries, 3);
  assert.equal(examples.length, 2);
  assert.equal(examples[0].question, '统计最近7个完整日的AD投放消耗，按广告账户看');
  assert.equal(examples[0].intent.metricId, 'ad_spend');
  assert.equal(examples[0].intent.grain, 'day');
  assert.equal(examples[0].intent.dimension, 'advertiser_name');
});

test('selectExamples 无关键词命中时返回空', () => {
  assert.deepEqual(selectExamples('随便问一句', fakeStore().queries), []);
  assert.deepEqual(selectExamples('', []), []);
  assert.deepEqual(selectExamples('AD消耗', null), []);
});

test('analyzeWithModel 校验失败时回喂错误并重试成功', async () => {
  const calls = [];
  const callModel = async (messages) => {
    calls.push(messages);
    if (calls.length === 1) return { ...validIntent, dimension: 'stat_cost' }; // measure 充当分组 → 校验失败
    return validIntent;
  };
  const result = await analyzeWithModel('按账户看AD消耗', [], depsFor(fakeStore(), callModel));
  assert.equal(result.modelUsed, true);
  assert.equal(result.metricId, 'ad_spend');
  assert.equal(calls.length, 2);
  const lastUser = calls[1].filter((m) => m.role === 'user').at(-1);
  assert.match(lastUser.content, /stat_cost/); // 错误信息已回喂
});

test('analyzeWithModel 一次通过只调用一次模型', async () => {
  let count = 0;
  const result = await analyzeWithModel('按账户看AD消耗', [], depsFor(fakeStore(), async () => { count++; return validIntent; }));
  assert.equal(result.metricId, 'ad_spend');
  assert.equal(count, 1);
});

test('analyzeWithModel 模型调用失败后重试', async () => {
  let count = 0;
  const result = await analyzeWithModel('按账户看AD消耗', [], depsFor(fakeStore(), async () => {
    count++;
    if (count === 1) throw new Error('模型请求失败（HTTP 429）');
    return validIntent;
  }));
  assert.equal(result.metricId, 'ad_spend');
  assert.equal(count, 2);
});

test('analyzeWithModel 重试耗尽后抛出校验错误', async () => {
  let count = 0;
  await assert.rejects(
    () => analyzeWithModel('按账户看AD消耗', [], depsFor(fakeStore(), async () => { count++; return { ...validIntent, dimension: 'stat_cost' }; })),
    /stat_cost/
  );
  assert.equal(count, 2);
});

test('analyzeWithModel 把已确认的历史问题作为 few-shot 示例放入提示，并过滤已删除指标', async () => {
  let systemPrompt = '';
  await analyzeWithModel('按账户看AD消耗', [], depsFor(fakeStore(), async (messages) => {
    systemPrompt = messages[0].content;
    return validIntent;
  }));
  assert.match(systemPrompt, /历史正确示例/);
  assert.match(systemPrompt, /统计最近7个完整日的AD投放消耗，按广告账户看/);
  assert.doesNotMatch(systemPrompt, /ADQ净成交ROI按部门/); // 引用了已不存在的指标，被过滤
});
