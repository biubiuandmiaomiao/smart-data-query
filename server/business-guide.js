import { createHash } from 'node:crypto';
export const fieldSignature=c=>createHash('sha256').update(JSON.stringify([c.name,c.type,c.comment||''])).digest('hex');
const known={
 stat_date:['业务日期','这条投放记录属于哪一天。用于选择日期和查看每天的变化。'],
 report_date:['报表日期','这条报表记录归属的日期。'],
 advertiser_id:['广告账户编号','用来区分广告账户的编号。即使都是数字，也不能相加；识别账户时请同时查看账户名称。'],
 advertiser_name:['广告账户名称','这笔投放所属的广告账户名称。可用于只看某个账户，或比较不同账户。'],
 account_id:['账户编号','区分不同账户的编号，不能当作数量相加。请结合账户名称核对。'],
 account_name:['账户名称','记录所属的账户，可用来选择统计对象。'],
 plan_id:['投放计划编号','区分不同投放计划的编号。请同时查看计划名称，不参与金额或数量计算。'],
 plan_name:['投放计划名称','这条记录属于哪个投放计划，可按计划筛选或对比。'],
 stat_cost:['投放消耗','该条记录记录的投放花费。确认币种、单位和记录是否重复后，才可以汇总。'],
 cost_yuan:['投放消耗（元）','该条记录的投放花费，字段以元计。请用真实记录核对平台口径。'],
 click_cnt:['点击次数','该条记录的广告点击次数。它是次数，不等于点击人数。'],
 show_cnt:['曝光次数','该条记录的广告展示次数。同一个人可能看到多次，不等于触达人数。'],
 order_net_amount_yuan:['净成交金额（元）','平台记录的净成交金额。哪些退款或扣减被排除，需要由业务人员结合平台数据确认。'],
 cdp_project_name:['项目名称','这条记录关联的业务项目，可按项目筛选或比较。'],
 data_topic:['数据分类','同一张表可能包含不同统计主题。必须确认要使用哪一类记录，避免重复统计。'],
 department_name:['部门名称','该条记录归属的部门，可用于筛选和分组。'],
 collection_time:['采集时间','系统什么时候读取了这条数据。不是投放发生的日期；多次采集可能记录同一笔累计数值。']
};
const purpose={scope:'选择哪些账户、计划或业务对象参与统计；也可按它分组。',time:'选择统计日期，并决定每天的数据归属。',measure:'这列是待计算的数量或金额；必须先核对单位及一条记录代表的对象。',derived:'这列是比例或单位成本。跨记录统计时应汇总分子和分母后重新计算。',snapshot:'这列表示某个时刻的数值，例如余额；不能把不同时间的值直接相加。',technical:'用于系统追溯，默认不参与业务统计。'};
export function businessGuide(c,annotation={}){
 const match=known[c.name];
 const confirmed=Boolean(annotation.confirmedAt&&annotation.confirmedSignature===fieldSignature(c));
 const clean=String(c.label||c.comment||'').split(/[;；\n]/)[0].replace(/\([^)]*\)|（[^）]*）/g,'').trim();
 const readable=/[\u4e00-\u9fff]/.test(clean)&&clean.length<=24&&!/[{}=]/.test(clean);
 return {businessLabel:annotation.label||match?.[0]||(readable?clean:'待命名字段'),businessExplanation:annotation.description||match?.[1]||`目前还不能可靠判断这列的业务含义。请先查看真实记录，与同一行的日期、账户和相关数值对照后再命名。`,usageExplanation:purpose[c.role],meaningStatus:confirmed?'confirmed':'pending',meaningConfirmedAt:confirmed?annotation.confirmedAt:null,guideBasis:confirmed?'业务已确认':match?'系统解释，待业务核对':'尚未确认'};
}
