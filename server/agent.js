import { readStore } from './store.js';
import { callModel } from './model.js';
import { getSource, listTables } from './schema.js';
import { MARKETING_DATABASE } from './policy.js';
import { selectRelevantSources, validateIntent } from './intent.js';
import { selectExamples } from './examples.js';

const MAX_ANALYZE_ATTEMPTS = 2;
const EXAMPLE_LIMIT = 3;

function describeSources(available) {
  return available.map((s) => ({
    id: s.id,
    comment: s.comment,
    semantics: s.semantics,
    columns: s.columns
      .filter((c) => c.sensitivity !== 'restricted' && c.role !== 'technical')
      .map((c) => ({
        name: c.name,
        type: c.type,
        label: c.businessLabel,
        role: c.role,
        unit: c.unit,
        meaning: c.businessExplanation,
        meaningStatus: c.meaningStatus,
      })),
  }));
}

function buildPrompt(state, today, sources, tables, examples) {
  const exampleSection = examples.length
    ? `历史正确示例（仅示范口径与字段用法，日期和范围是历史值，不要照搬；示例里已不存在的指标请忽略）：\n${examples
        .map((e, i) => `示例${i + 1} 问题：${e.question}\n示例${i + 1} 输出：${JSON.stringify(e.intent)}`)
        .join('\n')}\n`
    : '';
  return `你是营销数据字典助手。仅能访问营销库 ${MARKETING_DATABASE}，今天 ${today}，Asia/Shanghai。
核心设计：范围条件决定“统计哪些数据”，数值度量决定“计算什么”；分组决定“按什么看”。三者必须独立。账户、计划等ID即使是bigint也不是度量。
${exampleSection}指标字典：${JSON.stringify(state.metrics)}
真实字段及分类：${JSON.stringify(sources)}
营销表目录（未加载字段的表不可编造字段）：${JSON.stringify(tables.map((t) => ({ id: t.id, meaning: t.comment })))}
只输出 JSON：{summary:简要业务理解,metricId:现有指标ID或null,startDate:YYYY-MM-DD或null,endDate:YYYY-MM-DD左闭右开或null,grain:day/week/month/total,timeField:业务日期字段或空串,dimension:分组字段或空串,scopeFilters:[{field:范围字段,operator:eq/ne/in/gt/gte/lt/lte/not_null/is_null,value:值或in数组}],questions:[{question:待确认问题,options:[2到4个选项]}],suggestedMetric:配置对象或null}。
要求：
1. 没有明确时间、平台或口径就追问。不能默认把消耗当成AD消耗；AD与ADQ是两个来源，不可混同。无相关指标时metricId=null，说明缺什么，不退回其他指标。
2. 范围条件仅使用role=scope/time的字段。例如“只看账户A，按计划统计”：scopeFilters=[{field:'advertiser_name',operator:'eq',value:'A'}]，dimension=计划名称字段。筛选不依赖分组。账户、计划等ID必须输出JSON字符串，不能输出数字。
3. 度量只用role=measure字段。点击率、ROI、平均点击成本用ratio_of_sums：先SUM分子和分母，再相除；绝不能直接SUM或AVG平台返回的比率字段。CTR乘100，ROI乘1。账户ID不能求和。
4. 时间只用业务日期，不用采集、更新时间。累计快照必须snapshotPolicy=latest_per_day，且源元数据存在snapshotField和partitionKeys；缺少条件时提问，不执行。
5. 新指标suggestedMetric包括name,description,source,aggregation(sum/avg/min/max/count/count_distinct/ratio_of_sums),valueField,denominatorField,distinctFields数组,timeField,dimension,scale,multiplier,unit,filters数组,snapshotPolicy,notes。新建议永远status=draft，需要人工检查保存。
6. 不支持跨库查询。多平台/多表合并、同比环比需要先配置营销库内视图，不能静默丢弃这些要求。7. 未指定分组则dimension=''；未指定范围则scopeFilters=[]，指标固有filters由系统保留。8. 不确定字段单位或转化事件external_action时须提出业务确认。9. 不要重复追问用户已回答的条件。10. 面向普通用户用业务名称和白话解释，不要求用户阅读字段备注或SQL。meaningStatus=pending表示业务尚未确认，不得声称已经业务验证。
`;
}

export async function analyzeWithModel(query, messages = [], deps = {}) {
  const listTablesFn = deps.listTables || listTables;
  const getSourceFn = deps.getSource || getSource;
  const callModelFn = deps.callModel || callModel;
  const readStoreFn = deps.readStore || readStore;

  const tables = await listTablesFn();
  const context = [...messages.filter((m) => m.role === 'user').map((m) => m.content), query].join(' ');
  const state = readStoreFn();
  const ids = selectRelevantSources(context, state.metrics, tables);
  const loaded = await Promise.allSettled(ids.map((id) => getSourceFn(id)));
  const available = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!available.length) throw new Error('无法读取相关营销表，请先检查数据库连接');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const examples = selectExamples(query, state.queries, EXAMPLE_LIMIT).filter((e) =>
    state.metrics.some((m) => m.id === e.intent.metricId)
  );
  const prompt = buildPrompt(state, today, describeSources(available), tables, examples);

  const history = [
    ...messages.slice(-12).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 10000),
    })),
    { role: 'user', content: query },
  ];

  let lastError;
  for (let attempt = 0; attempt < MAX_ANALYZE_ATTEMPTS; attempt++) {
    let raw;
    try {
      raw = await callModelFn([{ role: 'system', content: prompt }, ...history]);
    } catch (error) {
      lastError = error;
      history.push({ role: 'user', content: `上一次没有拿到可用的 JSON 结果：${error.message}。请忽略失败原因，重新只输出 JSON。` });
      continue;
    }
    try {
      return validateIntent(raw, state.metrics, available);
    } catch (error) {
      lastError = error;
      history.push(
        { role: 'assistant', content: JSON.stringify(raw) },
        { role: 'user', content: `你刚才的输出没有通过校验：${error.message}。请修正后重新只输出 JSON，不要重复追问已经回答过的条件。` }
      );
      continue;
    }
  }
  throw lastError || new Error('模型多次尝试仍无法生成可用条件，请补充说明后重试');
}
