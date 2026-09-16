// Pure directed-acyclic-graph primitives for the collaboration harness.
//
// One dependency-free implementation is shared by the Node scheduler and the
// browser work-plan view, so the graph the scheduler refuses to run and the
// graph the panel draws can never disagree. Every mutation that adds edges
// (graph submission, runtime splitting) runs through `assertAcyclic` first, so
// a mission graph is acyclic by construction rather than by convention.

export const artifactKey=artifact=>`${artifact?.name}:${artifact?.version}`;

const isReplacement=works=>new Set(works.map(work=>work?.replaces).filter(Boolean));

// Artifact version -> producing work id. A replaced work item stops producing;
// its replacement takes the versions over, matching submission-time semantics.
export function producerIndex(mission,incoming=[]){
  const works=[...(mission?.workItems||[]),...incoming],replaced=isReplacement(works),index=new Map();
  for(const work of works){
    if(!work?.id||work.replacedBy||replaced.has(work.id))continue;
    for(const artifact of work.produces||[])if(!index.has(artifactKey(artifact)))index.set(artifactKey(artifact),work.id);
  }
  return index;
}

// Everything one work item waits for: explicit work dependencies plus the
// producers of its pinned input versions.
export function dependencyIds(mission,work,producers=producerIndex(mission)){
  return [...new Set([...(work?.dependsOn||[]),...(work?.requires||[]).map(artifact=>producers.get(artifactKey(artifact))).filter(Boolean)])];
}

const cycleMessage=chain=>`任务图形成循环依赖（包括阶段成果）：${chain.join(' → ')}`;

// Depth-first walk over the requested roots. Dependencies outside the lookup
// pool are skipped, exactly like dependency normalization elsewhere.
export function assertAcyclic(roots,{all=roots,resolve=work=>dependencyIds({workItems:all},work),fail=message=>{throw new Error(message);}}={}){
  const byId=new Map((all||[]).filter(Boolean).map(work=>[work.id,work])),state=new Map(),stack=[];
  const visit=work=>{
    if(!work?.id)return;
    const mark=state.get(work.id);
    if(mark==='done')return;
    if(mark==='open')fail(cycleMessage([...stack.slice(stack.indexOf(work.id)),work.id].map(id=>byId.get(id)?.key||id)));
    state.set(work.id,'open');stack.push(work.id);
    for(const id of resolve(work)||[]){const dependency=byId.get(id);if(dependency)visit(dependency);}
    stack.pop();state.set(work.id,'done');
  };
  for(const work of roots||[])visit(work);
  return roots;
}

// Kahn layering: layer 0 is immediately runnable, each later layer waits on the
// previous ones. `cycles` lists works that never became runnable, which only
// happens for data written outside this harness.
export function topoLayers(mission,incoming=[]){
  const works=[...(mission?.workItems||[]),...incoming],producers=producerIndex(mission,incoming),byId=new Map(works.map(work=>[work.id,work]));
  const dependencies=new Map(),dependents=new Map(works.map(work=>[work.id,[]]));
  for(const work of works){
    const list=dependencyIds(mission,work,producers).filter(id=>byId.has(id));
    dependencies.set(work.id,list);
    for(const id of list)dependents.get(id).push(work.id);
  }
  const remaining=new Map(works.map(work=>[work.id,dependencies.get(work.id).length])),layers=[],placed=new Set();
  let ready=works.filter(work=>remaining.get(work.id)===0).map(work=>work.id);
  while(ready.length){
    layers.push(ready);
    const next=[];
    for(const id of ready){
      placed.add(id);
      for(const dependent of dependents.get(id)){remaining.set(dependent,remaining.get(dependent)-1);if(remaining.get(dependent)===0)next.push(dependent);}
    }
    ready=next;
  }
  return {layers,cycles:works.filter(work=>!placed.has(work.id)).map(work=>work.id),byId};
}

// Longest downstream chain for each work item: how much work would stall if this
// item slipped. The scheduler uses it to prefer the critical path, the panel
// uses the chain to highlight it.
export function criticalPath(mission,incoming=[]){
  const works=[...(mission?.workItems||[]),...incoming],producers=producerIndex(mission,incoming),byId=new Map(works.map(work=>[work.id,work]));
  const dependents=new Map(works.map(work=>[work.id,[]]));
  for(const work of works)for(const id of dependencyIds(mission,work,producers))if(byId.has(id))dependents.get(id).push(work.id);
  const {layers,cycles}=topoLayers(mission,incoming),depth=new Map();
  for(const layer of [...layers].reverse())for(const id of layer){
    const downstream=dependents.get(id)||[];
    depth.set(id,downstream.length?1+Math.max(...downstream.map(next=>depth.get(next)||0)):0);
  }
  const roots=[...depth.keys()].sort((a,b)=>depth.get(b)-depth.get(a)||String(a).localeCompare(String(b)));
  const chain=[];
  for(let current=roots[0];current!==undefined;){
    chain.push(current);
    const next=(dependents.get(current)||[]).filter(id=>depth.has(id)).sort((a,b)=>depth.get(b)-depth.get(a)||String(a).localeCompare(String(b)))[0];
    current=next;
  }
  return {depth,critical:new Set(chain),chain,cycles,maxDepth:roots.length?depth.get(roots[0]):0};
}
