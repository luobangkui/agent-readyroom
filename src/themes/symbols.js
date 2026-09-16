import * as THREE from 'three';
// A small code-native leaf mark; no external texture or model download.
export function leafBadge(parent,size,x,y,z,color='#40504a'){
  const points=[];for(let i=0;i<=52;i++){const t=i/52*Math.PI*3.6,r=.055+.24*i/52;points.push(new THREE.Vector3(Math.cos(t)*r,Math.sin(t)*r,0));}
  points.push(new THREE.Vector3(.46,.25,0),new THREE.Vector3(.31,.51,0),new THREE.Vector3(.20,.29,0));
  const shape=new THREE.Group();shape.position.set(x,y,z);shape.scale.setScalar(size);
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color}));shape.add(line);
  const tail=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.26,-.06,0),new THREE.Vector3(-.5,-.19,0),new THREE.Vector3(-.25,-.25,0)]),new THREE.LineBasicMaterial({color}));shape.add(tail);parent.add(shape);return shape;
}
