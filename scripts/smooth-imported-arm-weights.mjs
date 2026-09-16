// Smooth arm bindings across UV seams without changing the source geometry.
export function smoothImportedArmWeights(geometry,joints,seamPartition,relaxBorder=false){
  const p=geometry.attributes.position,index=geometry.index,skin=geometry.attributes.skinIndex,weight=geometry.attributes.skinWeight;
  const groups=[],lookup=new Map(),vertexGroup=[];
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',')+(seamPartition?':'+seamPartition[i]:'');
    if(!lookup.has(key)){lookup.set(key,groups.length);groups.push({vertices:[],neighbors:new Set(),weights:new Float64Array(joints.length)});}
    const g=lookup.get(key);vertexGroup.push(g);groups[g].vertices.push(i);
    for(let c=0;c<4;c++)groups[g].weights[skin.getComponent(i,c)]+=weight.getComponent(i,c);
  }
  for(const g of groups)for(let j=0;j<joints.length;j++)g.weights[j]/=g.vertices.length;
  for(let i=0;i<index.count;i+=3)for(let a=0;a<3;a++)for(let b=0;b<3;b++)if(a!==b){const x=vertexGroup[index.getX(i+a)],y=vertexGroup[index.getX(i+b)];if(x!==y)groups[x].neighbors.add(y);}
  const armIndices=joints.map((b,i)=>/Arm|Hand/.test(b.name)?i:-1).filter(i=>i>=0);
  const affected=groups.map(g=>armIndices.some(i=>g.weights[i]>.001));
  if(relaxBorder)for(let pass=0;pass<2;pass++){const next=affected.slice();groups.forEach((g,i)=>{if(affected[i])for(const n of g.neighbors)next[n]=true;});next.forEach((v,i)=>affected[i]=v);}
  // Local relaxation removes pinches at sleeve/robe junctions. Foot/leg
  // bindings are outside this mask and retain their exact planted contacts.
  for(let pass=0;pass<12;pass++){
    const next=groups.map((g,i)=>{
      if(!affected[i]||!g.neighbors.size)return g.weights;
      const w=new Float64Array(joints.length);
      for(let j=0;j<joints.length;j++){let sum=0;for(const n of g.neighbors)sum+=groups[n].weights[j];w[j]=.55*g.weights[j]+.45*sum/g.neighbors.size;}
      return w;
    });
    groups.forEach((g,i)=>g.weights=next[i]);
  }
  for(const g of groups){const entries=Array.from(g.weights,(w,i)=>[i,w]).sort((a,b)=>b[1]-a[1]).slice(0,4),total=entries.reduce((sum,[,w])=>sum+w,0);
    for(const v of g.vertices)for(let c=0;c<4;c++){skin.setComponent(v,c,entries[c][0]);weight.setComponent(v,c,entries[c][1]/total);}
  }
}
