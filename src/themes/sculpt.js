import * as THREE from 'three';

export function hairCap(long=false){
  const positions=[],indices=[],segments=48,rows=18;
  for(let row=0;row<=rows;row++)for(let col=0;col<=segments;col++){
    const phi=col/segments*Math.PI*2,front=Math.max(0,Math.sin(phi)),back=Math.max(0,-Math.sin(phi));
    const end=1.57-.58*front+(long?.80:.27)*back;
    const theta=row/rows*end;positions.push(.364*Math.cos(phi)*Math.sin(theta),.37*Math.cos(theta)+.018,.328*Math.sin(phi)*Math.sin(theta)-.025);
    if(row<rows&&col<segments){const a=row*(segments+1)+col,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function lockGeometry(start,control,end,width=.09){
  const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(...start),new THREE.Vector3(...control),new THREE.Vector3(...end));
  const positions=[],indices=[],rows=12,sides=10;
  for(let row=0;row<=rows;row++){
    const t=row/rows,center=curve.getPoint(t),tangent=curve.getTangent(t).normalize();
    const reference=Math.abs(tangent.z)>.85?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1);
    const u=new THREE.Vector3().crossVectors(tangent,reference).normalize(),v=new THREE.Vector3().crossVectors(tangent,u).normalize();
    const radius=width*(.85+.32*Math.sin(Math.PI*t))*Math.pow(1-t,.78)+.002;
    for(let j=0;j<=sides;j++){const a=j/sides*Math.PI*2,p=center.clone().addScaledVector(u,Math.cos(a)*radius).addScaledVector(v,Math.sin(a)*radius*.5);positions.push(p.x,p.y,p.z);if(row<rows&&j<sides){const k=row*(sides+1)+j,n=k+sides+1;indices.push(k,k+1,n,n,k+1,n+1);}}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
export function coatGeometry(){return new THREE.LatheGeometry([new THREE.Vector2(.41,.32),new THREE.Vector2(.395,.4),new THREE.Vector2(.31,.65),new THREE.Vector2(.30,.96),new THREE.Vector2(.26,1.12),new THREE.Vector2(.19,1.20)],48,.35,Math.PI*2-.70);}
