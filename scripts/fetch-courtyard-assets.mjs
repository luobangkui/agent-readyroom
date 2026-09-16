// Import verified CC0 material sets and small props, retaining original maps.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const target=path.resolve(fileURLToPath(new URL('../public/assets/courtyard/',import.meta.url)));
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const manifest={provider:'Poly Haven',license:'CC0',licenseURL:'https://polyhaven.com/license',assets:[]};
async function download(entry,relative){
  const destination=path.resolve(target,relative);if(!destination.startsWith(target+path.sep))throw new Error('Invalid asset path');
  let bytes;try{bytes=await readFile(destination);}catch{}
  if(!bytes||hash(bytes,'md5')!==entry.md5){const response=await fetch(entry.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Download failed: ${response.status} ${entry.url}`);bytes=Buffer.from(await response.arrayBuffer());}
  if(hash(bytes,'md5')!==entry.md5)throw new Error('Checksum mismatch: '+relative);
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
  return {path:relative,url:entry.url,bytes:bytes.length,sha256:hash(bytes)};
}
for(const id of ['wood_table_001','coated_pine','oak_veneer_01','white_plaster_02','cotton_jersey']){
  const response=await fetch('https://api.polyhaven.com/files/'+id);if(!response.ok)throw new Error('Metadata unavailable: '+id);const files=await response.json();
  const maps={Diffuse:'color',nor_gl:'normal',Rough:'roughness',AO:'ao'};
  const resources=await Promise.all(Object.entries(maps).map(([key,name])=>download(files[key]['1k'].jpg,`${id}/${name}.jpg`)));
  manifest.assets.push({id,type:'material',source:`https://polyhaven.com/a/${id}`,resources});console.log(id,resources.reduce((s,r)=>s+r.bytes,0),'bytes');
}
for(const id of ['potted_plant_02','chinese_tea_table']){
  const response=await fetch('https://api.polyhaven.com/files/'+id);if(!response.ok)throw new Error('Metadata unavailable: '+id);const files=await response.json(),model=files.gltf['1k'].gltf;
  const resources=await Promise.all([download(model,`${id}/model.gltf`),...Object.entries(model.include).map(([name,entry])=>download(entry,`${id}/${name}`))]);
  manifest.assets.push({id,type:'model',source:`https://polyhaven.com/a/${id}`,resources});console.log(id,resources.reduce((s,r)=>s+r.bytes,0),'bytes');
}
await writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
