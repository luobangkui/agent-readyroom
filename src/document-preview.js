import './document-preview.css';
import {renderDocumentMarkup} from './document-renderer.js';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),missionId=params.get('mission'),requested=params.get('path'),line=Number(params.get('line'))||0;
let token='',info,sourceMode=!!line,generation=0;
const urls=new Set(),imageCache=new Map();
const createURL=blob=>{const url=URL.createObjectURL(blob);urls.add(url);return url;};
window.addEventListener('pagehide',event=>{if(!event.persisted)for(const url of urls)URL.revokeObjectURL(url);});
const status=(text,error=false)=>{$('document-status').textContent=text;$('document-status').classList.toggle('error',error);};
async function requestFile(file,{raw=false}={}){
  const response=await fetch(`/api/missions/${encodeURIComponent(missionId)}/file`,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':token},body:JSON.stringify({path:file,raw})});
  if(!response.ok){let message='读取文档失败';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
  return raw?response.blob():response.json();
}
async function loadImage(file){
  if(!imageCache.has(file))imageCache.set(file,(async()=>{const image=await requestFile(file);if(image.kind!=='image'||image.size>5*1024*1024)throw Error('仅支持 5 MB 内的本地图片');const blob=await requestFile(file,{raw:true});return createURL(blob.slice(0,blob.size,image.mime));})());
  return imageCache.get(file);
}
async function render(){
  const current=++generation;let node;$('document-content').setAttribute('aria-busy','true');
  $('toggle-source').textContent=sourceMode?'渲染预览':'查看源码';
  if(info.content!==undefined&&(sourceMode||info.kind==='text')){
    node=document.createElement('pre');node.className='source-document';const lines=info.content.split('\n');
    for(const [index,text] of lines.slice(0,10000).entries()){const row=document.createElement('span');row.className='source-line'+(index+1===line?' highlighted':'');row.id=`line-${index+1}`;row.dataset.line=String(index+1);row.textContent=text||' ';node.append(row);}
    if(lines.length>10000)status('源码仅显示前 10,000 行，可下载原文件查看完整内容。');
  }else if(['markdown','html'].includes(info.kind))node=await renderDocumentMarkup(info,{missionId,origin:location.origin,anchor:location.hash,loadImage,createURL});
  else if(info.kind==='image'&&info.canDownload){node=document.createElement('img');node.className='document-image';node.alt=info.name;const blob=await requestFile(info.path,{raw:true});node.src=createURL(blob.slice(0,blob.size,info.mime));}
  else if(info.kind==='pdf'&&info.canDownload){node=document.createElement('iframe');node.className='document-frame';node.title='PDF 文档预览';node.setAttribute('sandbox','allow-scripts');const blob=await requestFile(info.path,{raw:true});node.src=createURL(blob.slice(0,blob.size,'application/pdf'));status('PDF 使用浏览器内置阅读器；若未显示，可下载原文件。');}
  else{node=document.createElement('div');node.className='unsupported-document';node.textContent=info.canDownload?'此格式暂不支持浏览器渲染，可下载原文件或复制本地路径打开。':'文件超过 50 MB，请复制本地路径后在本机打开。';}
  if(current!==generation)return;$('document-content').replaceChildren(node);$('document-content').setAttribute('aria-busy','false');
  if(line&&(sourceMode||info.kind==='text'))document.getElementById(`line-${line}`)?.scrollIntoView({block:'center'});
  else if(location.hash){let anchor;try{anchor=decodeURIComponent(location.hash.slice(1));}catch{anchor=location.hash.slice(1);}(document.getElementById('doc-heading-'+anchor)||document.getElementById(anchor))?.scrollIntoView();}
}
$('reload-document').onclick=()=>location.reload();
$('toggle-source').onclick=()=>{sourceMode=!sourceMode;void render().catch(error=>{status(error.message,true);$('document-content').setAttribute('aria-busy','false');});};
$('copy-path').onclick=async()=>{try{await navigator.clipboard.writeText(info.absolutePath);status('已复制本地路径。');}catch{status('无法自动复制，请选中上方路径后复制。',true);}};
$('download-document').onclick=async()=>{const button=$('download-document');button.disabled=true;try{const blob=await requestFile(info.path,{raw:true}),link=document.createElement('a');link.href=createURL(blob);link.download=info.name;link.click();}catch(error){status(error.message,true);}finally{button.disabled=!info.canDownload;}};
async function load(){
  if(!missionId||!requested)throw Error('链接缺少目标或文件路径，请从待命室消息里的文档链接打开。');
  const response=await fetch('/api/documents/bootstrap');if(!response.ok)throw Error('文档预览尚未启用，请在当前任务结束后重启本地服务。');const bootstrap=await response.json();token=bootstrap.token;
  if(!bootstrap.capabilities?.localFilePreview)throw Error('文档预览需要重启本地服务后生效。当前目标可以继续执行，请勿直接中断。');
  info=await requestFile(requested);document.title=info.name+' · 文档预览';$('document-name').textContent=info.name;$('document-path').textContent=info.absolutePath;$('document-size').textContent=`${(info.size/1024).toFixed(1)} KB`;
  $('copy-path').disabled=false;$('download-document').disabled=!info.canDownload;$('toggle-source').hidden=!['markdown','html'].includes(info.kind);
  status(info.truncated?'文档较大，仅预览前 512 KB；可下载原文件查看完整内容。':info.kind==='html'?'HTML 使用隔离预览；脚本和外部资源已禁用。':'本地只读预览 · 不会修改原文件');await render();
}
void load().catch(error=>{$('document-name').textContent='无法打开文档';$('document-path').textContent=requested||'';$('document-content').setAttribute('aria-busy','false');status(error.message,true);});
