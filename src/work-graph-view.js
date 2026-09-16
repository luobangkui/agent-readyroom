// Work-plan DAG view: draws the collaboration graph the scheduler actually runs.
//
// The layout comes from the same pure module the server schedules with, so the
// picture can show what is runnable in parallel and what the critical path is.
// Batches are rows (a batch flows downward, parallel items across), which suits
// the tall work-plan panel far better than a wide strip. Node text is ellipsized
// and clipped, so a long wait reason can never spill across the drawing; the full
// task and wait text lives in the hover title. Everything is escaped here: keys,
// task text and wait reasons are untrusted model output.
import {topoLayers,criticalPath,producerIndex,artifactKey} from './work-graph.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NODE={width:158,height:56,gapX:16,gapY:46,pad:16,header:16};
const MAX_NODES=40,LABEL_CHARS=13;
const tone=status=>['running','starting','suspending'].includes(status)?'running':status==='completed'?'done':['failed','stopped','interrupted'].includes(status)?'failed':status==='ready'?'ready':'waiting';
const stateText={waiting_input:'等输入',ready:'待领取',queued:'待开始',starting:'准备',running:'执行中',waiting:'等答复',suspending:'收尾中',suspended:'已挂起',completed:'已结束',failed:'失败',stopped:'已停止',interrupted:'中断'};
const waitChip={input:'等输入',artifact:'等契约',evidence:'等证据',resource:'等资源',scope:'等范围',model:'等模型',worker:'等人',provider:'等连接',tool:'等工具',human:'等回复',split:'待汇总',drain:'收尾中',timeout:'超时',storage:'等存储',recovery:'待恢复',stop:'停止中',uncertain:'待确认'};
// SVG has no text-overflow: clip by character count and keep a per-node clipPath
// as the backstop for anything wider than expected.
const clip=value=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>LABEL_CHARS?`${text.slice(0,LABEL_CHARS-1)}…`:text;};
// A工作单 key 往往比节点宽：优先在 - _ . / 或驼峰处折成两行，真的还长才省略，
// 完整 key 始终能在悬停标题与下方详情卡里看到。
function wrapKey(value,max=LABEL_CHARS){
  const text=String(value??'').replace(/\s+/g,' ').trim();if(!text)return [];
  if(text.length<=max)return [text];
  const breakable=[...text.matchAll(/[-_./]|[a-z](?=[A-Z])/g)].map(match=>match.index+(match[0].length===1&&!['-','_','.','/'].includes(match[0])?1:1));
  const candidates=breakable.filter(index=>index>1&&index<=max).sort((a,b)=>b-a);
  const cut=candidates[0]??max;
  const head=text.slice(0,cut).replace(/[-_./]$/,''),tail=text.slice(cut).replace(/^[-_./]/,'');
  return [head,clip(tail)];
}

// Barycenter pass keeps dependencies roughly above the work that consumes them.
function orderLayers(layers,edges){
  const placed=new Map();
  layers.forEach((layer,index)=>{
    const scored=layer.map(id=>{
      if(index===0)return {id,score:0};
      const parents=(edges.get(id)||[]).filter(parent=>placed.has(parent)).map(parent=>placed.get(parent));
      return {id,score:parents.length?parents.reduce((sum,row)=>sum+row,0)/parents.length:Number.MAX_SAFE_INTEGER};
    });
    scored.sort((a,b)=>a.score-b.score||String(a.id).localeCompare(String(b.id)));
    scored.forEach((entry,row)=>placed.set(entry.id,row));
  });
  return placed;
}

function nodeContent(work,nameOf){
  const chips=[];
  if(work.waitReason?.message)chips.push(`<tspan class="dag-chip wait">${escape(waitChip[work.waitReason.kind]||'等待')}</tspan>`);
  if(work.reviewOf?.length)chips.push('<tspan class="dag-chip review">独立复核</tspan>');
  if(work.splitOf)chips.push('<tspan class="dag-chip child">子任务</tspan>');
  if(work.children?.length)chips.push(`<tspan class="dag-chip split">拆分 ${work.children.length}</tspan>`);
  if(work.callback)chips.push('<tspan class="dag-chip callback">回调</tspan>');
  if((work.priority||0)>=8)chips.push(`<tspan class="dag-chip priority">P${escape(work.priority)}</tspan>`);
  const assignee=work.agentId?nameOf(work.agentId):'';
  return {chips:chips.slice(0,2).join(''),detail:[stateText[work.status]||work.status,assignee].filter(Boolean).join(' · ')};
}

// 点开节点后的完整信息：节点里放不下的文字都在这里，不依赖悬停。
function detailCard(work,nameOf){
  if(!work)return '';
  const rows=[
    ['状态',`${stateText[work.status]||work.status}${work.agentId?` · ${nameOf(work.agentId)}`:''}${work.role?`（${work.role}）`:''}`],
    ['任务',work.task||'—'],
    ...(work.waitReason?.message?[['等待原因',work.waitReason.message]]:[]),
    ...(work.dependsOn?.length?[['完成依赖',work.dependsOn.map(id=>nameOf(id)).join('、')]]:[]),
    ...(work.requires?.length?[['固定输入',work.requires.map(entry=>`${entry.name}:${entry.version}${entry.status?`（${entry.status}）`:''}`).join('、')]]:[]),
    ...(work.produces?.length?[['阶段产出',work.produces.map(entry=>`${entry.name}:${entry.version}`).join('、')]]:[]),
    ['读取范围',(work.scope?.readPaths||[]).join('、')||'无'],
    ['写入范围',(work.scope?.writePaths||[]).join('、')||'无'],
    ...(work.acceptance?.length?[['验收条件',work.acceptance.map((item,index)=>`${index}. ${item}`).join('；')]]:[]),
    ...(work.report?[['交付证据',`${work.report.verdict}：${work.report.summary}`]]:[]),
    ...(work.children?.length?[['已拆分',`${work.children.length} 个子任务`]]:[]),
  ];
  return `<div class="dag-detail" data-dag-detail><div class="dag-detail-head"><strong>${escape(work.key||work.id)}</strong><button type="button" data-dag-close aria-label="关闭详情">×</button></div><dl>${rows.map(([label,value])=>`<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl></div>`;
}

export function collaborationGraph(m,nameOf=id=>id,{selectedId='',maximized=false}={}){
  const all=(m?.workItems||[]).filter(work=>work.protocol===2&&!work.replacedBy);
  if(!all.length)return '';
  const listed=all.slice(0,MAX_NODES),visible=new Set(listed.map(work=>work.id));
  const index=producerIndex(m),byId=new Map(listed.map(work=>[work.id,work]));
  const edges=new Map(),artifactEdges=new Set();
  for(const work of listed){
    const explicit=(work.dependsOn||[]).filter(id=>byId.has(id));
    const artifact=(work.requires||[]).map(requirement=>index.get(artifactKey(requirement))).filter(id=>id&&byId.has(id));
    edges.set(work.id,[...new Set([...explicit,...artifact])]);
    for(const id of artifact)if(!explicit.includes(id))artifactEdges.add(`${id}->${work.id}`);
  }
  // Layering runs over every work item (replaced and legacy ones included), so
  // the drawn set is filtered back to the graph this view actually shows.
  const raw=topoLayers(m),layers=raw.layers.map(layer=>layer.filter(id=>visible.has(id))).filter(layer=>layer.length);
  const cycles=raw.cycles.filter(id=>visible.has(id));
  const {critical,chain:fullChain}=criticalPath(m),chain=fullChain.filter(id=>visible.has(id));
  const drawn=cycles.length?[...layers,cycles]:layers;
  const rows=orderLayers(drawn,edges);
  const width=Math.max(...drawn.map(layer=>layer.length))*(NODE.width+NODE.gapX)-NODE.gapX+NODE.pad*2;
  const height=drawn.length*(NODE.height+NODE.gapY)-NODE.gapY+NODE.pad*2+NODE.header;
  const position=new Map();
  drawn.forEach((layer,row)=>layer.forEach((id,column)=>position.set(id,{x:NODE.pad+column*(NODE.width+NODE.gapX),y:NODE.pad+NODE.header+row*(NODE.height+NODE.gapY)})));
  const links=[];
  for(const work of listed)for(const parent of edges.get(work.id)){
    const from=position.get(parent),to=position.get(work.id);if(!from||!to)continue;
    const start={x:from.x+NODE.width/2,y:from.y+NODE.height},end={x:to.x+NODE.width/2,y:to.y},mid=(start.y+end.y)/2;
    const onPath=critical.has(parent)&&critical.has(work.id);
    links.push(`<path class="dag-edge${onPath?' critical':''}${artifactEdges.has(`${parent}->${work.id}`)?' artifact':''}" d="M ${start.x} ${start.y} C ${start.x} ${mid}, ${end.x} ${mid}, ${end.x} ${end.y}" marker-end="url(#dag-arrow)"><title>${escape(byId.get(parent)?.key||parent)} → ${escape(work.key)}</title></path>`);
  }
  const clips=listed.map((work,i)=>`<clipPath id="dag-clip-${i}"><rect width="${NODE.width-14}" height="${NODE.height-6}" rx="6"></rect></clipPath>`).join('');
  const nodes=listed.map((work,i)=>{
    const at=position.get(work.id),{chips,detail}=nodeContent(work,nameOf);
    const lines=wrapKey(work.key||work.id);
    const hint=[`${work.key} · ${stateText[work.status]||work.status}`,detail,work.waitReason?.message?`等待：${work.waitReason.message}`:'',work.task||''].filter(Boolean).join('\n').slice(0,400);
    const keyText=lines.map((line,index)=>`<text class="dag-key" y="${16+index*11}">${escape(line)}</text>`).join('');
    const metaY=lines.length>1?38:29,chipY=lines.length>1?49:40;
    return `<g class="dag-node ${tone(work.status)}${work.id===selectedId?' selected':''}" data-dag-node="${escape(work.id)}" tabindex="0" role="button" aria-label="${escape(`${work.key}：${stateText[work.status]||work.status}${detail?` · ${detail}`:''}`)}" transform="translate(${at.x},${at.y})"><title>${escape(hint)}</title><rect width="${NODE.width}" height="${NODE.height}" rx="9"></rect><g clip-path="url(#dag-clip-${i})" transform="translate(7,0)">${keyText}<text class="dag-meta" y="${metaY}">${escape(clip(detail))}</text><text class="dag-badges" y="${chipY}">${chips}</text></g></g>`;
  }).join('');
  const batches=drawn.map((layer,row)=>`<text class="dag-batch" x="${NODE.pad}" y="${NODE.pad+row*(NODE.height+NODE.gapY)+NODE.header-4}">${cycles.length&&row===drawn.length-1?'未排入批次（存在环）':`第 ${row+1} 批 · ${layer.length} 项可并行`}</text>`).join('');
  const truncated=all.length>listed.length?`<p class="dag-note">图里只画了前 ${MAX_NODES} 项，另有 ${all.length-listed.length} 项见下方工作计划列表。</p>`:'';
  const cycle=cycles.length?`<p class="dag-cycle">检测到 ${cycles.length} 项无法排入批次（数据中存在环）：${cycles.map(id=>escape(byId.get(id)?.key||id)).join('、')}</p>`:'';
  const selected=byId.get(selectedId);
  return `<section class="collaboration-dag${maximized?' maximized':''}"><div class="collaboration-heading"><h3>任务图（无环）</h3><span>${all.length} 项 · ${drawn.length} 批 · 关键路径 ${chain.length} 层</span><button type="button" class="dag-expand" data-dag-expand aria-pressed="${maximized?'true':'false'}">${maximized?'↙ 还原任务图':'⛶ 最大化任务图'}</button></div>
<div class="dag-scroll"><svg class="dag" viewBox="0 0 ${width} ${height}" role="img" aria-label="协作任务依赖图：${all.length} 项工作单，按 ${drawn.length} 个批次自上而下排列">
<defs><marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker>${clips}</defs>
${batches}${links.join('')}${nodes}
</svg></div>
<p class="dag-legend"><span class="dag-dot running"></span>执行中 <span class="dag-dot done"></span>已结束 <span class="dag-dot waiting"></span>等输入 <span class="dag-dot failed"></span>未成功 · 每一行是一批可并行任务；实线＝工作依赖，虚线＝阶段契约依赖，加粗＝关键路径；点击节点看完整内容，Esc 退出最大化。</p>${detailCard(selected,nameOf)}${truncated}${cycle}</section>`;
}
