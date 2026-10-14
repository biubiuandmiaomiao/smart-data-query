import { MARKETING_DATABASE } from './policy.js';
const ocean = `${MARKETING_DATABASE}.ocean_ad_delivery_daily_detail`;
const adq = `${MARKETING_DATABASE}.adq_account_daily_databoard`;
const make = (id,name,source,valueField,unit,description,extra={}) => ({ id,name,source,valueField,unit,description,aliases:[],owner:'营销数据',status:'active',aggregation:'sum',denominatorField:'',multiplier:1,distinctFields:[],timeField:source===ocean?'stat_date':'report_date',dimension:source===ocean?'advertiser_name':'department',scale:1,filters:source===ocean?[{field:'data_topic',operator:'eq',value:'BASIC_DATA'}]:[],notes:source===ocean?'AD竞价种草通日投放明细；按账户、日期、数据主题、报表项目和报表单元唯一。消耗单位为元。':'ADQ账户日快照；一行一账户一天。金额单位为元，时间归因以 report_time_line 为准。',snapshotPolicy:'none',revision:1,updatedAt:new Date().toISOString(),...extra });
export function marketingSeeds(){return [
 make('ad_spend','AD投放消耗',ocean,'stat_cost','元','所选日期和投放范围内的广告消耗总额，金额原单位为元。',{aliases:['AD消耗','AD花费','广告费']}),
 make('ad_impressions','AD曝光量',ocean,'show_cnt','次','所选日期和投放范围内的展示次数之和。',{aliases:['展示数','曝光次数']}),
 make('ad_clicks','AD点击量',ocean,'click_cnt','次','所选日期和投放范围内的点击次数之和。',{aliases:['点击数']}),
 make('ad_ctr','AD点击率',ocean,'click_cnt','%','所选范围的总点击量 ÷ 总曝光量 × 100。先汇总再相除，曝光为零时返回空值。',{aliases:['CTR'],aggregation:'ratio_of_sums',denominatorField:'show_cnt',multiplier:100}),
 make('ad_cpc','AD平均点击成本',ocean,'stat_cost','元/次','所选范围的总消耗 ÷ 总点击量。点击量为零时返回空值。',{aliases:['CPC'],aggregation:'ratio_of_sums',denominatorField:'click_cnt'}),
 make('adq_spend','ADQ投放消耗',adq,'cost_yuan','元','ADQ账户日报中，所选日期、部门和账户范围内的当日广告花费合计。',{aliases:['ADQ花费']}),
 make('adq_net_roi','ADQ净成交ROI',adq,'order_net_amount_yuan','倍','ADQ总净成交金额 ÷ 总广告花费。先汇总后计算，不对每日ROI求和或简单平均。',{aliases:['ADQ净ROI'],aggregation:'ratio_of_sums',denominatorField:'cost_yuan'})
];}
