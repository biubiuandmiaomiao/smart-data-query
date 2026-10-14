// UI dates are inclusive; saved definitions and SQL keep an exclusive upper bound.
export function shiftDate(value,days){if(!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';const time=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)return '';return new Date(time+days*86400000).toISOString().slice(0,10);}
export const inclusiveEnd=value=>shiftDate(value,-1);
export const exclusiveEnd=value=>shiftDate(value,1);
export function compareDecimal(a,b){
 const parse=v=>{const m=String(v).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);if(!m)return null;const exponent=Number(m[4]||0);if(Math.abs(exponent)>1000)return null;return {integer:BigInt((m[1]||'')+m[2]+(m[3]||'')),scale:(m[3]||'').length-exponent};};
 const x=parse(a),y=parse(b);if(!x||!y)return String(a).localeCompare(String(b),'zh-CN',{numeric:true});const scale=Math.max(x.scale,y.scale);const nx=x.integer*10n**BigInt(scale-x.scale),ny=y.integer*10n**BigInt(scale-y.scale);return nx<ny?-1:nx>ny?1:0;
}
export function resultRows(rows,{search='',sort='original'}={}){
 const needle=search.trim().toLocaleLowerCase();const filtered=rows.filter(row=>!needle||Object.values(row).some(value=>value!==null&&String(value).toLocaleLowerCase().includes(needle)));
 if(sort==='original')return filtered;
 const [key,direction]=sort.split(':');return [...filtered].sort((a,b)=>{if(a[key]===null)return b[key]===null?0:1;if(b[key]===null)return -1;const cmp=key==='value'?compareDecimal(a[key],b[key]):String(a[key]??'').localeCompare(String(b[key]??''),'zh-CN',{numeric:true});return direction==='desc'?-cmp:cmp;});
}
export function resultSummary(rows){const known=rows.every(r=>r._matchedRows!==undefined);return {matchedRows:known?rows.reduce((sum,r)=>sum+BigInt(r._matchedRows),0n).toString():null,rows:rows.filter(r=>r._matchedRows===undefined||BigInt(r._matchedRows)>0n).map(({_matchedRows,...rest})=>rest)};}
