import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {lockGeometry} from '../src/themes/sculpt.js';

// A closed, continuous head and fitted clothes for Sakura and Hinata. The body
// still uses the shared animation rig, so chair and walking clips stay compatible.
export function refineFemale(root,id){
  const sakura=id==='sakura',skin=sakura?'#f1c9b6':'#efcbbb',hair=sakura?'#d398ab':'#30364f',shirt=sakura?'#ad4c65':'#b9afcd';
  const headBone=root.getObjectByName('head'),chest=root.getObjectByName('chest'),rig=root.getObjectByName('Rig');
  for(const name of [`${id}_Face`,`${id}_Scalp`,`${id}_Head_Details`,`${id}_Outfit_Details`])root.getObjectByName(name)?.removeFromParent();
  const details=new T.Group();details.name=`${id}_Sculpted_Head`;root.add(details);
  const material=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.72,...extra});
  const add=(geometry,color,parent=details,extra={})=>{const o=new T.Mesh(geometry,material(color,extra));o.castShadow=o.receiveShadow=true;parent.add(o);return o;};
  const tube=(points,color,r=.008,parent=details)=>add(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),32,r,8,false),color,parent);
  const rxAt=y=>{const c=T.MathUtils.clamp((y-1.68)/.49,-1,1),theta=Math.acos(c);return .50*Math.sin(theta)*(1-.20*T.MathUtils.smoothstep(theta,1.7,2.8));};
  const front=(x,y)=>{
    const c=T.MathUtils.clamp((y-1.68)/.49,-1,1),r=rxAt(y),sin=Math.sqrt(1-c*c),z=.424*sin*Math.sqrt(Math.max(0,1-x*x/(r*r||1)));
    const nose=.035*Math.exp(-Math.pow(x/.052,2)-Math.pow((y-1.535)/.068,2));
    const cheeks=.012*(Math.exp(-Math.pow((x-.24)/.12,2))+Math.exp(-Math.pow((x+.24)/.12,2)))*Math.exp(-Math.pow((y-1.49)/.14,2));
    return z+nose+cheeks;
  };
  const positions=[],indices=[],rows=48,cols=80;
  for(let row=0;row<=rows;row++)for(let col=0;col<=cols;col++){
    const theta=row/rows*Math.PI,phi=col/cols*Math.PI*2,y=1.68+.49*Math.cos(theta),x=rxAt(y)*Math.sin(phi),z=Math.cos(phi)>=0?front(x,y):.42*Math.sin(theta)*Math.cos(phi);
    positions.push(x,y,z);if(row<rows&&col<cols){const k=row*(cols+1)+col,n=k+cols+1;indices.push(k,n,k+1,n,n+1,k+1);}
  }
  const head=new T.BufferGeometry();head.setAttribute('position',new T.Float32BufferAttribute(positions,3));head.setIndex(indices);head.computeVertexNormals();
  const face=add(head,skin);face.name=`${id}_Smooth_Face`;
  // Eye and mouth surfaces follow the sculpt; no floating spheres or flat face card.
  function patch(shape,color,offset=.008,extra={}){
    const g=new T.ShapeGeometry(shape,32),p=g.attributes.position;
    for(let i=0;i<p.count;i++)p.setZ(i,front(p.getX(i),p.getY(i))+offset);g.computeVertexNormals();
    return add(g,color,details,{side:T.DoubleSide,...extra});
  }
  function ellipse(x,y,w,h,color,offset=.008,extra={}){const shape=new T.Shape();shape.absellipse(x,y,w,h,0,Math.PI*2,false,0);return patch(shape,color,offset,extra);}
  const facialLine=(points,color,r=.006,offset=.014)=>tube(points.map(([x,y])=>[x,y,front(x,y)+offset]),color,r);
  for(const side of [-1,1]){
    const x=side*.188,y=1.635,w=.126,eye=new T.Shape();eye.moveTo(x-w,y);eye.bezierCurveTo(x-w*.50,y+.105,x+w*.60,y+.102,x+w,y+.008);eye.bezierCurveTo(x+w*.56,y-.065,x-w*.65,y-.066,x-w,y);
    patch(eye,'#fff7ed',.012);
    ellipse(x,y+.008,.063,.081,sakura?'#315e52':'#aca6c0',.018);
    ellipse(x,y+.008,.050,.068,sakura?'#79a992':'#e3ddee',.021);
    ellipse(x,y+.008,sakura?.023:.010,sakura?.049:.029,sakura?'#253e37':'#c5bed8',.024);
    ellipse(x-.022,y+.038,.016,.021,'#fffdf4',.028);ellipse(x+.020,y-.021,.008,.010,'#e8f1dc',.026);
    facialLine([[x-w,y],[x-w*.55,y+.067],[x,y+.077],[x+w*.58,y+.064],[x+w,y+.008]],'#423544',.009,.016);
    const edge=x+side*w;facialLine([[edge-side*.02,y+.039],[edge+side*.030,y+.057]],'#423544',.007,.018);
    facialLine([[x-.089,y+.16],[x-.01,y+.18],[x+.080,y+.165]],sakura?'#9c697a':'#575273',.007);
    ellipse(side*.322,1.476,.068,.029,'#e5969b',.009,{transparent:true,opacity:.27,depthWrite:false});
    const ear=add(new T.SphereGeometry(.071,24,16),skin);ear.position.set(side*.475,1.55,-.004);ear.scale.set(.6,1,.55);
  }
  facialLine([[-.048,1.386],[0,1.373],[.05,1.39]],'#af737d',.005,.006);
  if(sakura){const diamond=new T.Shape();diamond.moveTo(0,1.899);diamond.lineTo(.022,1.874);diamond.lineTo(0,1.849);diamond.lineTo(-.022,1.874);diamond.closePath();patch(diamond,'#8b668f',.011);}

  const hairMaterial=material(hair,{roughness:.49});
  function strand(a,b,c,width){const mesh=new T.Mesh(lockGeometry(a,b,c,width),hairMaterial);mesh.castShadow=true;details.add(mesh);return mesh;}
  const hp=[],hi=[],hRows=32,hCols=80;
  for(let row=0;row<=hRows;row++)for(let col=0;col<=hCols;col++){
    const phi=col/hCols*Math.PI*2,frontness=Math.max(0,Math.cos(phi)),backness=Math.max(0,-Math.cos(phi)),end=1.86-.86*frontness+(sakura?.35:.70)*backness,t=row/hRows*end;
    hp.push(.529*Math.sin(t)*Math.sin(phi),1.72+.514*Math.cos(t),-.022+.462*Math.sin(t)*Math.cos(phi));
    if(row<hRows&&col<hCols){const k=row*(hCols+1)+col,n=k+hCols+1;hi.push(k,n,k+1,n,n+1,k+1);}
  }
  const cap=new T.BufferGeometry();cap.setAttribute('position',new T.Float32BufferAttribute(hp,3));cap.setIndex(hi);cap.computeVertexNormals();const capMesh=new T.Mesh(cap,hairMaterial);capMesh.castShadow=true;details.add(capMesh);
  if(sakura){
    strand([-.045,2.12,.30],[-.23,1.98,.475],[-.34,1.68,.33],.15);
    strand([.04,2.12,.30],[.21,1.97,.48],[.33,1.72,.32],.145);
    for(const side of [-1,1])for(let i=0;i<3;i++)strand([side*.40,1.96,-.11+i*.11],[side*.53,1.68,-.03+i*.10],[side*(.41-i*.01),1.34+i*.035,.11+i*.06],.113);
    // The hairband sits on the crown, leaving Sakura's forehead clear.
    const band=new T.Mesh(new T.TorusGeometry(.513,.025,10,64,Math.PI),material('#9e4257'));band.position.set(0,1.73,-.04);band.rotation.x=Math.PI/2;band.rotation.z=Math.PI;details.add(band);
  }else{
    for(const side of [-1,1])for(let i=0;i<3;i++)strand([side*.40,1.98,-.13+i*.12],[side*.53,1.52,-.08+i*.12],[side*.43,1.07+i*.015,.02+i*.11],.13);
    const fp=[],fi=[],fr=18,fc=36;
    for(let row=0;row<=fr;row++)for(let col=0;col<=fc;col++){const t=row/fr,y=1.858+t*.28,x=(col/fc-.5)*(.635-.22*t),z=front(x,y)+.037;fp.push(x,y,z);if(row<fr&&col<fc){const k=row*(fc+1)+col,n=k+fc+1;fi.push(k,k+1,n,k+1,n+1,n);}}
    const fringe=new T.BufferGeometry();fringe.setAttribute('position',new T.Float32BufferAttribute(fp,3));fringe.setIndex(fi);fringe.computeVertexNormals();add(fringe,hair,details,{roughness:.49,side:T.DoubleSide});
    for(const x of [-.23,-.12,.015,.13,.24])tube([[x*.67,2.095,front(x*.67,2.095)+.042],[x*.85,1.98,front(x*.85,1.98)+.043],[x,1.878,front(x,1.878)+.043]],'#424560',.003);
  }

  const sourceBody=root.getObjectByName('Rogue_Body'),bodyRig=sourceBody.skeleton;
  sourceBody.visible=false;
  const profile=new T.CatmullRomCurve3([new T.Vector3(.33,.425,.27),new T.Vector3(.30,.57,.25),new T.Vector3(.273,.74,.22),new T.Vector3(.315,.96,.235),new T.Vector3(.28,1.105,.21),new T.Vector3(.145,1.205,.135)]);
  const bp=[],bi=[],skinIndices=[],skinWeights=[],br=28,bc=48,bones=Object.fromEntries(bodyRig.bones.map((b,i)=>[b.name,i]));
  for(let row=0;row<=br;row++)for(let col=0;col<=bc;col++){
    const point=profile.getPoint(row/br),a=col/bc*Math.PI*2;bp.push(point.x*Math.sin(a),point.y,point.z*Math.cos(a));
    let low,high,w;if(point.y<.72){low=bones.hips;high=bones.spine;w=T.MathUtils.smoothstep(point.y,.47,.72);}else{low=bones.spine;high=bones.chest;w=T.MathUtils.smoothstep(point.y,.72,1.04);}skinIndices.push(low,high,0,0);skinWeights.push(1-w,w,0,0);
    if(row<br&&col<bc){const k=row*(bc+1)+col,n=k+bc+1;bi.push(k,k+1,n,k+1,n+1,n);}
  }
  const bg=new T.BufferGeometry();bg.setAttribute('position',new T.Float32BufferAttribute(bp,3));bg.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));bg.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));bg.setIndex(bi);bg.computeVertexNormals();
  const top=new T.SkinnedMesh(bg,material(shirt,{side:T.DoubleSide}));top.name=`${id}_Fitted_Top`;top.bind(bodyRig,sourceBody.bindMatrix);rig.add(top);
  const clothes=new T.Group();clothes.name=`${id}_Tailoring`;root.add(clothes);
  const box=(w,h,d,color,x,y,z)=>{const mesh=add(new RoundedBoxGeometry(w,h,d,3,.018),color,clothes);mesh.position.set(x,y,z);return mesh;};
  if(sakura){
    tube([[0,1.19,.145],[0,1.06,.227],[0,.91,.245],[0,.71,.23],[0,.5,.266]],'#eacdd0',.012,clothes);
    const emblem=add(new T.TorusGeometry(.092,.014,10,40),'#f1d6d9',clothes);emblem.position.set(0,.96,-.247);emblem.rotation.y=Math.PI;
    for(const side of [-1,1])box(.10,.18,.048,'#ae4a61',side*.102,1.205,.117).rotation.z=side*.3;
  }else{
    const hood=add(new T.TorusGeometry(.18,.069,14,48),'#d9d2e3',clothes);hood.position.set(0,1.17,-.12);hood.rotation.x=Math.PI/2;hood.scale.set(1.15,1,.9);
    tube([[0,1.18,.16],[0,1.0,.246],[0,.81,.237],[0,.58,.27]],'#eeebef',.012,clothes);
    for(const side of [-1,1]){tube([[side*.10,1.16,.18],[side*.12,1.00,.255],[side*.13,.94,.257]],'#eee8df',.008,clothes);box(.14,.06,.02,'#a096b9',side*.17,.70,.23).rotation.z=-side*.16;}
  }
  root.traverse(o=>{
    if(!o.isSkinnedMesh)return;
    const p=o.geometry.attributes.position;
    if(o.name.includes('Rogue_Arm')){
      const g=o.geometry.clone(),v=g.attributes.position,col=g.attributes.color;
      for(let i=0;i<v.count;i++){v.setY(i,1.105+(v.getY(i)-1.105)*.83);v.setZ(i,v.getZ(i)*.84);const x=Math.abs(v.getX(i));const c=new T.Color(sakura?(x<.56?skin:x<.80?'#514651':skin):x<.80?shirt:skin);col.setXYZ(i,c.r,c.g,c.b);}g.computeVertexNormals();o.geometry=g;
    }else if(o.name.includes('Rogue_Leg')){const g=o.geometry.clone(),v=g.attributes.position;for(let i=0;i<v.count;i++){const side=v.getX(i)<0?-1:1;v.setX(i,side*.17+(v.getX(i)-side*.17)*.86);v.setZ(i,v.getZ(i)*.90);}g.computeVertexNormals();o.geometry=g;}
  });
  root.updateMatrixWorld(true);headBone.attach(details);chest.attach(clothes);root.updateMatrixWorld(true);
}
