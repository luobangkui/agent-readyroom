import * as THREE from 'three';

export function faceTexture(style,closed=false){
  if(typeof document==='undefined')return new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d');c.scale(.5,.5);c.lineCap='round';c.lineJoin='round';
  const ink=style.elder?'#777064':'#403d3b';
  for(const side of [-1,1]){
    const x=512+side*188,y=430;
    c.save();c.translate(x,y);
    if(closed||style.mask&&side===-1){c.strokeStyle=ink;c.lineWidth=13;c.beginPath();c.moveTo(-83,3);c.quadraticCurveTo(0,23,83,-3);c.stroke();}
    else{
      const h=style.sleepy||style.elder?30:52;
      c.beginPath();c.moveTo(-88,6);c.bezierCurveTo(-42,-h,35,-h,86,-3);c.bezierCurveTo(44,h*.68,-39,h*.72,-88,6);c.closePath();c.fillStyle='#faf5e9';c.fill();
      c.save();c.clip();c.fillStyle=style.iris||'#637064';c.beginPath();c.ellipse(5,2,31,43,0,0,Math.PI*2);c.fill();c.fillStyle=style.iris==='#c9c5d8'?'#aba6ba':'#343e42';c.beginPath();c.ellipse(5,4,13,30,0,0,Math.PI*2);c.fill();c.fillStyle='#fffdf4';c.beginPath();c.arc(-6,-15,9,0,Math.PI*2);c.fill();c.restore();
      c.strokeStyle=ink;c.lineWidth=style.tattoo?21:11;c.beginPath();c.moveTo(-88,6);c.bezierCurveTo(-42,-h,35,-h,86,-3);c.stroke();
      c.lineWidth=5;c.beginPath();c.moveTo(-75,14);c.quadraticCurveTo(0,h*.72,70,10);c.stroke();
      if(style.feminine){c.lineWidth=9;c.beginPath();c.moveTo(side*80,-2);c.lineTo(side*96,-22);c.stroke();}
    }
    c.strokeStyle=style.elder?'#a8a49a':style.hair;c.lineWidth=style.elder?20:12;c.beginPath();c.moveTo(-79,-89);c.quadraticCurveTo(0,style.sleepy?-111:-116,76,-81);c.stroke();
    if(style.elder){c.strokeStyle='#a78871';c.lineWidth=5;for(let i=0;i<2;i++){c.beginPath();c.moveTo(-76,63+i*18);c.quadraticCurveTo(0,82+i*18,74,61+i*18);c.stroke();}}
    c.restore();
  }
  c.strokeStyle='#bc9074';c.lineWidth=7;c.beginPath();c.moveTo(509,519);c.quadraticCurveTo(495,551,518,552);c.stroke();
  c.strokeStyle='#a67a67';c.lineWidth=9;c.beginPath();c.moveTo(467,636);c.quadraticCurveTo(512,652,557,632);c.stroke();
  if(style.whiskers){c.strokeStyle='#aa8057';c.lineWidth=7;for(const side of [-1,1])for(let i=0;i<3;i++){c.beginPath();c.moveTo(512+side*246,529+i*35);c.lineTo(512+side*333,511+i*40);c.stroke();}}
  if(style.tearLines){c.strokeStyle='#8c766c';c.lineWidth=6;for(const side of [-1,1]){c.beginPath();c.moveTo(512+side*125,476);c.quadraticCurveTo(512+side*162,520,512+side*167,561);c.stroke();}}
  if(style.tattoo){c.font='bold 130px "Hiragino Sans", "PingFang SC", sans-serif';c.fillStyle='#a95148';c.fillText('愛',680,288);}
  if(style.mask){c.fillStyle='#3e4c55';c.beginPath();c.moveTo(118,498);c.quadraticCurveTo(512,554,906,484);c.lineTo(920,1024);c.lineTo(100,1024);c.closePath();c.fill();c.strokeStyle='#596570';c.lineWidth=5;c.beginPath();c.moveTo(225,748);c.quadraticCurveTo(512,790,787,736);c.stroke();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export function makeFace(parent,style){
  const open=faceTexture(style),closed=faceTexture(style,true);
  const material=new THREE.MeshStandardMaterial({map:open,transparent:true,alphaTest:.025,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
  const geometry=new THREE.SphereGeometry(.349,48,32,Math.PI*.17,Math.PI*.66,Math.PI*.24,Math.PI*.58);
  const mesh=new THREE.Mesh(geometry,material);mesh.scale.set(1.03,1.05,.90);parent.add(mesh);
  return {mesh,open,closed,blink:false};
}
