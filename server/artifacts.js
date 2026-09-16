import {readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';

const ignored=new Set(['node_modules','dist','build','coverage','vendor','venv','__pycache__','target']);
const textExtensions=new Set(['.md','.txt','.html','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.go','.rs','.json','.yaml','.yml','.toml','.csv','.svg']);
export async function scanWorkspace(cwd){
  const entries={};let count=0;
  async function walk(directory,depth){if(depth>5||count>=2000)return;let files;try{files=await readdir(directory,{withFileTypes:true});}catch{return;}
    for(const entry of files){if(count++>=2000)break;if(entry.name.startsWith('.')||ignored.has(entry.name)||/(?:secret|credential|password|private.?key|auth.?token)/i.test(entry.name))continue;const full=path.join(directory,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await walk(full,depth+1);continue;}if(!entry.isFile()||!textExtensions.has(path.extname(entry.name)))continue;try{const info=await stat(full);if(info.size<=200000)entries[full]={mtime:info.mtimeMs,size:info.size};}catch{}}
  }
  await walk(cwd,0);return entries;
}
export async function collectArtifacts(mission){
  const current=await scanWorkspace(mission.cwd),baseline=mission.baseline||{};
  for(const [file,info] of Object.entries(current)){
    if(!mission.baseline&&info.mtime<Date.parse(mission.createdAt))continue;
    if(baseline[file]?.mtime===info.mtime&&baseline[file]?.size===info.size)continue;
    const exists=mission.files.find(f=>f.path===file);if(exists?.source!=='workspace'&&exists)continue;
    let content;try{content=(await readFile(file,'utf8')).slice(0,40000);}catch{continue;}
    const entry={path:file,status:'observed',source:'workspace',updatedAt:new Date(info.mtime).toISOString(),content,truncated:info.size>40000};
    if(exists)Object.assign(exists,entry);else mission.files.push(entry);
  }
}
