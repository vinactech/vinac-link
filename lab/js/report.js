function safeName(s){return String(s||'run').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();}
export function downloadText(text,filename,type='text/plain'){
  const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exportJson(report){downloadText(JSON.stringify(report,null,2),`vinac-nus-${safeName(report.session?.id)}-${Date.now()}.json`,'application/json');}
function flatRows(obj,prefix='',rows=[]){for(const [k,v] of Object.entries(obj||{})){const key=prefix?`${prefix}.${k}`:k;if(v===null||typeof v!=='object')rows.push([key,v]);else if(Array.isArray(v))rows.push([key,JSON.stringify(v)]);else flatRows(v,key,rows);}return rows;}
export function exportCsv(report){const rows=[['field','value'],...flatRows(report)];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');downloadText(csv,`vinac-nus-${safeName(report.session?.id)}-${Date.now()}.csv`,'text/csv');}
