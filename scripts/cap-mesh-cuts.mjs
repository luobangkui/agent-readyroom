import * as T from 'three';

// Close only boundaries created by removing fused contact faces. Existing UV
// seams are welded for edge discovery; the original geometry is not changed.
export function capMeshCuts(geometry,originalTriangles,seamPartition){
  const p=geometry.attributes.position,uv=geometry.attributes.uv,skin=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
  const weld=new Map(),baseWeld=new Map(),ids=[],baseIds=[];
  for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');if(!baseWeld.has(key))baseWeld.set(key,baseWeld.size);baseIds.push(baseWeld.get(key));const partitioned=key+(seamPartition?':'+seamPartition[i]:'');if(!weld.has(partitioned))weld.set(partitioned,weld.size);ids.push(weld.get(partitioned));}
  function edges(triangles,vertexIds=ids){const map=new Map();for(let i=0;i<triangles.length;i+=3)for(let j=0;j<3;j++){const a=triangles[i+j],b=triangles[i+(j+1)%3],x=vertexIds[a],y=vertexIds[b];if(x===y)continue;const key=x<y?x+':'+y:y+':'+x;if(map.has(key))map.get(key).count++;else map.set(key,{a,b,count:1,baseKey:baseIds[a]<baseIds[b]?baseIds[a]+':'+baseIds[b]:baseIds[b]+':'+baseIds[a]});}return map;}
  const before=edges(originalTriangles,baseIds),after=edges(Array.from(geometry.index.array));
  const remaining=new Set([...after].filter(([key,e])=>e.count===1&&before.get(e.baseKey)?.count>=2).map(([,e])=>e));
  const positions=[],normals=[],uvs=[],indices=[],skinIndices=[],skinWeights=[];let loops=0;
  function vertex(point,normal,tex,binding){const id=positions.length/3;positions.push(...point);normals.push(...normal);uvs.push(...tex);skinIndices.push(...binding.map(e=>e[0]));skinWeights.push(...binding.map(e=>e[1]));return id;}
  while(remaining.size){
    const first=remaining.values().next().value,loop=[first.a];let edge=first;remaining.delete(edge);
    while(ids[edge.b]!==ids[first.a]){loop.push(edge.b);const next=[...remaining].find(e=>ids[e.a]===ids[edge.b]);if(!next)throw new Error('Open contact cut; inspect before exporting');remaining.delete(next);edge=next;}
    if(loop.length<3)continue;loops++;
    const center=new T.Vector3(),normal=new T.Vector3(),combined=new Map();
    for(let i=0;i<loop.length;i++){
      const a=new T.Vector3().fromBufferAttribute(p,loop[i]),b=new T.Vector3().fromBufferAttribute(p,loop[(i+1)%loop.length]);center.add(a);normal.add(new T.Vector3().crossVectors(b,a));
      for(let c=0;c<4;c++){const bone=skin.getComponent(loop[i],c);combined.set(bone,(combined.get(bone)||0)+weights.getComponent(loop[i],c)/loop.length);}
    }
    center.divideScalar(loop.length);if(normal.lengthSq()<1e-14)continue;normal.normalize();
    const binding=[...combined].sort((a,b)=>b[1]-a[1]).slice(0,4),total=binding.reduce((n,e)=>n+e[1],0);for(const e of binding)e[1]/=total;while(binding.length<4)binding.push([0,0]);
    // A local albedo sample avoids sampling unrelated atlas islands on a cap.
    const tex=[uv.getX(loop[0]),uv.getY(loop[0])],mid=vertex(center.toArray(),normal.toArray(),tex,binding);
    const rim=loop.map(i=>vertex(new T.Vector3().fromBufferAttribute(p,i).toArray(),normal.toArray(),tex,[0,1,2,3].map(c=>[skin.getComponent(i,c),weights.getComponent(i,c)])));
    for(let i=0;i<rim.length;i++)indices.push(rim[(i+1)%rim.length],rim[i],mid);
  }
  const caps=new T.BufferGeometry();caps.setAttribute('position',new T.Float32BufferAttribute(positions,3));caps.setAttribute('normal',new T.Float32BufferAttribute(normals,3));caps.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));caps.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));caps.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));caps.setIndex(indices);
  return {geometry:caps,loops,triangles:indices.length/3};
}
