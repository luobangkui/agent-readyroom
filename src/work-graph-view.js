// Work-plan DAG view: draws the collaboration graph the scheduler actually runs.
//
// The layout comes from the same pure module the server schedules with, so the
// picture can show what is runnable in parallel, what the critical path is, and
// whether the graph is still acyclic. Everything is escaped here; task text and
// keys are untrusted model output.
import {topoLayers,criticalPath,producerIndex,artifactKey} from './work-graph.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NODE={width:150,height:46,gapX:52,gapY:16,pad:18};
const tone=status=>['running','starting','suspending'].includes(status)?'running':status==='completed'?'done':['failed','stopped','interrupted'].includes(status)?'failed':status==='ready'?'ready':'waiting';
const stateText={waiting_input:'等输入',ready:'待领取',queued:'待开始',starting:'准备',running:'执行中',waiting:'等答复',suspending:'收尾中',suspended:'已挂起',completed:'已结束',failed:'失败',stopped:'已停止',interrupted:'中断'};

// One barycenter pass keeps dependencies roughly above the work that consumes
// them without a full graph-drawing algorithm.
function orderLayers(layers,byId,edges){
  const order=new Map(),placed=new Map();
  layers.forEach((layer,index)=>{
    const scored=layer.map(id=>{
      if(index===0)return {id,score:order.size};
      const parents=(edges.get(id)||[]).filter(parent=>placed.has(parent)).map(parent=>placed.get(parent));
      return {id,score:parents.length?parents.reduce((n,row)=>n+row,0)/parents.length:Number.MAX_SAFE_INTEGER};
    });
    scored.sort((a,b)=>a.score-b.score||String(a.id).localeCompare(String(b.id)));
    scored.forEach((entry,row)=>{order.set(entry.id,row);placed.set(entry.id,row);});
  });
  return order;
}

export function collaborationGraph(m,nameOf=id=>id){
  const works=(m?.workItems||[]).filter(work=>work.protocol===2&&!work.replacedBy);
  if(!works.length)return '';
  const index=producerIndex(m),byId=new Map(works.map(work=>[work.id,work]));
  const edges=new Map(),artifactEdges=new Set();
  for(const work of works){
    const explicit=(work.dependsOn||[]).filter(id=>byId.has(id));
    const artifact=(work.requires||[]).map(req=>index.get(artifactKey(req))).filter(id=>id&&byId.has(id));
    edges.set(work.id,[...new Set([...explicit,...artifact])]);
    for(const id of artifact)if(!explicit.includes(id))artifactEdges.add(`${id}->${work.id}`);
  }
  // Layering runs over every work item (replaced and legacy ones included), so
  // the drawn set is filtered back to the graph this view actually shows.
  const visible=new Set(works.map(work=>work.id));
  const raw=topoLayers(m),layers=raw.layers.map(layer=>layer.filter(id=>visible.has(id))).filter(layer=>layer.length);
  const cycles=raw.cycles.filter(id=>visible.has(id));
  const {critical,chain:fullChain}=criticalPath(m),chain=fullChain.filter(id=>visible.has(id));
  // Hand-edited data can still contain a cycle; those nodes never reach a layer,
  // so they are drawn in a flagged trailing column instead of disappearing.
  const drawnLayers=cycles.length?[...layers,cycles]:layers;
  const rows=orderLayers(drawnLayers,byId,edges);
  const height=Math.max(...drawnLayers.map(layer=>layer.length))*(NODE.height+NODE.gapY)-NODE.gapY+NODE.pad*2;
  const width=drawnLayers.length*(NODE.width+NODE.gapX)-NODE.gapX+NODE.pad*2;
  const position=new Map();
  drawnLayers.forEach((layer,column)=>layer.forEach(id=>position.set(id,{x:NODE.pad+column*(NODE.width+NODE.gapX),y:NODE.pad+rows.get(id)*(NODE.height+NODE.gapY)})));
  const links=[];
  for(const work of works)for(const parent of edges.get(work.id)){
    const from=position.get(parent),to=position.get(work.id);if(!from||!to)continue;
    const start={x:from.x+NODE.width,y:from.y+NODE.height/2},end={x:to.x,y:to.y+NODE.height/2},mid=(start.x+end.x)/2;
    const onPath=critical.has(parent)&&critical.has(work.id);
    links.push(`<path class="dag-edge${onPath?' critical':''}${artifactEdges.has(`${parent}->${work.id}`)?' artifact':''}" d="M ${start.x} ${start.y} C ${mid} ${start.y}, ${mid} ${end.y}, ${end.x} ${end.y}" marker-end="url(#dag-arrow)"><title>${escape(byId.get(parent)?.key||parent)} → ${escape(work.key)}</title></path>`);
  }
  const nodes=works.map(work=>{
    const at=position.get(work.id),assignee=work.agentId?nameOf(work.agentId):'';
    const badges=[
      critical.has(work.id)?'<b class="dag-badge path">关键路径</b>':'',
      work.children?.length?`<b class="dag-badge split">拆分 ${work.children.length}</b>`:'',
      work.splitOf?'<b class="dag-badge child">子任务</b>':'',
      work.reviewOf?.length?'<b class="dag-badge review">独立复核</b>':'',
      work.callback?'<b class="dag-badge callback">回调</b>':'',
      (work.priority||0)>=8?`<b class="dag-badge priority">P${escape(work.priority)}</b>`:''
    ].join('');
    const wait=work.waitReason?.message?escape(String(work.waitReason.message).slice(0,60)):'';
    return `<g class="dag-node ${tone(work.status)}" transform="translate(${at.x},${at.y})"><title>${escape(work.key)} · ${escape(stateText[work.status]||work.status)} · ${escape(work.task||'').slice(0,280)}</title><rect width="${NODE.width}" height="${NODE.height}" rx="9"></rect><text class="dag-key" x="10" y="18">${escape(work.key||work.id)}</text><text class="dag-meta" x="10" y="33">${escape(stateText[work.status]||work.status)}${assignee?` · ${escape(assignee)}`:''}</text><text class="dag-badges" x="10" y="45">${wait||badges}</text></g>`;
  }).join('');
  const batches=drawnLayers.map((layer,column)=>`<text class="dag-batch" x="${NODE.pad+column*(NODE.width+NODE.gapX)}" y="12">${cycles.length&&column===drawnLayers.length-1?'未排入批次（存在环）':`第 ${column+1} 批 · ${layer.length} 项可并行`}</text>`).join('');
  const cycle=cycles.length?`<p class="dag-cycle">检测到 ${cycles.length} 项无法排入批次（数据中存在环）：${cycles.map(id=>escape(byId.get(id)?.key||id)).join('、')}</p>`:'';
  return `<section class="collaboration-dag"><div class="collaboration-heading"><h3>任务图（无环）</h3><span>${works.length} 项 · ${layers.length} 批 · 关键路径 ${chain.length} 层</span></div>
<div class="dag-scroll"><svg class="dag" viewBox="0 0 ${Math.max(width,240)} ${height+NODE.pad}" role="img" aria-label="协作任务依赖图，共 ${works.length} 项，${layers.length} 个并行批次">
<defs><marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>
${batches}${links.join('')}${nodes}
</svg></div>
<p class="dag-legend"><span class="dag-dot running"></span>执行中 <span class="dag-dot done"></span>已结束 <span class="dag-dot waiting"></span>等输入 <span class="dag-dot failed"></span>未成功 · 实线＝工作依赖，虚线＝阶段契约依赖，加粗＝关键路径；依赖只能指向已存在的 key/ID，提交与拆分前都会复查环。</p>${cycle}</section>`;
}
