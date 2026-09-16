import path from 'node:path';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';

export const TEXT_PREVIEW_LIMIT=512*1024;
export const FILE_DOWNLOAD_LIMIT=50*1024*1024;
const textTypes=new Set(['.txt','.log','.json','.jsonl','.csv','.tsv','.xml','.svg','.yaml','.yml','.toml','.ini','.conf','.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.scss','.py','.go','.rs','.java','.c','.h','.cpp','.hpp','.sql','.sh','.bash','.zsh','.diff','.patch','.mdx']);
const images={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif'};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const inside=(root,file)=>file.startsWith(root+path.sep);
function sensitive(relative){return relative.split(path.sep).some(part=>part.startsWith('.')||/^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|(?:auth|token|credentials|secrets)(?:\.[^.]+)?)$/i.test(part)||/(?:secret|credential|password|private[-_.]?key|auth[-_.]?token)/i.test(part)||/\.(?:env|pem|key|p12|pfx|jks|keystore)$/i.test(part));}
export async function documentPath(mission,requested){
  if(typeof requested!=='string'||!requested.trim()||requested.length>4000||/[\x00-\x1f\\]/.test(requested)||/^[a-z][a-z\d+.-]*:\/\//i.test(requested))fail(400,'请提供有效的本地文件路径。');
  let root;try{root=await realpath(mission.cwd);}catch{fail(404,'项目目录已不可用。');}
  const candidate=path.resolve(root,requested.trim());
  // macOS /tmp and /var commonly resolve through /private; compare canonical
  // parents so valid absolute links keep working without allowing an escape.
  let parent;try{parent=await realpath(path.dirname(candidate));}catch{fail(inside(root,candidate)?404:403,'文件不存在或不在允许的预览范围内。');}
  const canonicalCandidate=path.join(parent,path.basename(candidate));
  if(!inside(root,canonicalCandidate)||sensitive(path.relative(root,canonicalCandidate)))fail(403,'仅能预览本目标项目内的非敏感文件，隐藏配置和密钥不开放。');
  let actual;try{actual=await realpath(candidate);}catch{fail(404,'文件不存在，可能已被移动或尚未生成。');}
  if(!inside(root,actual)||sensitive(path.relative(root,actual)))fail(403,'文件或符号链接不在允许的预览范围内。');
  return {absolutePath:actual,path:path.relative(root,actual),name:path.basename(actual)};
}
async function readBounded(handle,count){
  const buffer=Buffer.alloc(count);let offset=0;
  while(offset<count){const {bytesRead}=await handle.read(buffer,offset,count-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
  return buffer.subarray(0,offset);
}
export async function readDocument(mission,requested,{raw=false}={}){
  const file=await documentPath(mission,requested);let handle;
  try{
    handle=await open(file.absolutePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await handle.stat();
    if(!info.isFile())fail(400,'此链接指向目录或特殊文件，请选择一个具体文件。');
    const ext=path.extname(file.name).toLowerCase();
    let kind=['.md','.markdown'].includes(ext)?'markdown':['.html','.htm'].includes(ext)?'html':images[ext]?'image':ext==='.pdf'?'pdf':textTypes.has(ext)||!ext?'text':'download';
    const isText=['markdown','html','text'].includes(kind),canDownload=info.size<=FILE_DOWNLOAD_LIMIT;
    if(raw&&!canDownload)fail(413,'文件超过 50 MB，请复制本地路径后在本机打开。');
    const data=await readBounded(handle,Math.min(info.size,raw?FILE_DOWNLOAD_LIMIT:isText?TEXT_PREVIEW_LIMIT:16));
    const after=await handle.stat();if(after.size!==info.size||after.mtimeMs!==info.mtimeMs)fail(409,'文件正在更新，请稍后刷新预览。');
    if(raw)return {...file,data};
    if(isText&&data.includes(0))kind='download';
    if(kind==='pdf'&&!data.subarray(0,5).equals(Buffer.from('%PDF-')))kind='download';
    return {...file,kind,size:info.size,modifiedAt:info.mtime.toISOString(),mime:images[ext]|| (kind==='pdf'?'application/pdf':'application/octet-stream'),canDownload,truncated:isText&&info.size>data.length,...(['markdown','html','text'].includes(kind)?{content:data.toString('utf8').replace(/^\uFEFF/,'')}:{})};
  }catch(error){if(error.status)throw error;if(['ENOENT','ELOOP'].includes(error.code))fail(404,'文件已变化，请刷新后重试。');if(error.code==='EACCES')fail(403,'当前进程没有读取此文件的权限。');throw error;}
  finally{await handle?.close();}
}
