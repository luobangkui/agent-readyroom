export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode=value=>{try{return decodeURIComponent(value);}catch{return value;}};
export function parseLocalTarget(raw,basePath=''){
  if(typeof raw!=='string')return null;let value=raw.trim().replace(/^<([\s\S]*)>$/,'$1').replace(/\\([\\()[\]<> ])/g,'$1');
  if(!value||/[\x00-\x1f]/.test(value)||value.startsWith('//'))return null;
  let anchor='',line=null;
  if(/^file:/i.test(value)){try{const url=new URL(value);if(url.hostname&&url.hostname!=='localhost')return null;anchor=decode(url.hash.slice(1));value=decode(url.pathname);}catch{return null;}}
  else{if(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^([^:/]+\.[a-z\d_-]{1,12}):\d+(?::\d+)?(?:#.*)?$/i.test(value))return null;const hash=value.indexOf('#');if(hash>=0){anchor=decode(value.slice(hash+1));value=value.slice(0,hash);}value=decode(value.split('?')[0]);}
  const suffix=value.match(/:(\d+)(?::\d+)?$/);if(suffix){line=Number(suffix[1]);value=value.slice(0,-suffix[0].length);}
  if(/^L\d+(?:-L?\d+)?$/.test(anchor)){line=Number(anchor.match(/\d+/)[0]);anchor='';}
  if(line!==null&&(!Number.isSafeInteger(line)||line<1||line>1000000))line=null;
  if(!value&&basePath)value=basePath;
  else if(value&&!value.startsWith('/')&&basePath)value=basePath.split('/').slice(0,-1).concat(value).join('/');
  if(!value||value.startsWith('~'))return null;
  return {path:value,line,anchor};
}
export function documentHref(missionId,target){
  if(!missionId||!target?.path)return null;
  const query=new URLSearchParams({mission:missionId,path:target.path});if(target.line)query.set('line',String(target.line));
  return '/document.html?'+query+(target.anchor?'#'+encodeURIComponent(target.anchor):'');
}
export function localFileLink(missionId,file,label='预览 ↗'){
  const href=documentHref(missionId,{path:file});return href?`<a class="file-reference" href="${escapeHtml(href)}" target="_self" rel="noopener noreferrer" title="预览 ${escapeHtml(file)}">${escapeHtml(label)}</a>`:escapeHtml(label);
}

// Keep chat formatting unchanged, but parse balanced Markdown link targets.
function replaceLinks(input,render){
  let out='',i=0;
  while(i<input.length){
    if(input[i]!=='['||input[i-1]==='\\'){out+=input[i++];continue;}
    let end=i+1,brackets=1;
    for(;end<input.length;end++){if(input[end]==='\\'){end++;continue;}if(input[end]==='[')brackets++;if(input[end]===']'&&!--brackets)break;}
    if(brackets||input[end+1]!=='('){out+=input[i++];continue;}
    const start=end+2;let finish=start,target;
    if(input[start]==='<'){finish=input.indexOf('>',start+1);const tail=finish<0?null:input.slice(finish+1).match(/^\s*(?:["'][^"'\n]*["']\s*)?\)/);if(!tail){out+=input[i++];continue;}target=input.slice(start+1,finish);finish+=tail[0].length;}
    else{let depth=1;for(;finish<input.length;finish++){if(input[finish]==='\\'){finish++;continue;}if(input[finish]==='(')depth++;if(input[finish]===')'&&!--depth)break;}if(depth){out+=input[i++];continue;}target=input.slice(start,finish).trim().replace(/\s+"[^"\n]*"$/,'');}
    out+=render(input.slice(i+1,end),target);i=finish+1;
  }
  return out;
}
export function formatMessage(value,missionId){
  const blocks=[],stash=html=>{blocks.push(html);return `\u0000BLOCK${blocks.length-1}\u0000`;};
  let text=String(value??'').replace(/\u0000/g,'');
  text=text.replace(/```[^\n]*\n([\s\S]*?)```/g,(_,code)=>stash(`<pre class="message-code"><code>${escapeHtml(code)}</code></pre>`));
  text=text.replace(/`([^`\n]+)`/g,(_,code)=>stash(`<code>${escapeHtml(code)}</code>`));
  text=replaceLinks(text,(label,target)=>{
    const safeLabel=escapeHtml(label.replace(/\\([()[\]\\])/g,'$1'));
    if(/^https?:\/\//i.test(target)){try{const url=new URL(target);return stash(`<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${safeLabel} ↗</a>`);}catch{}}
    const local=parseLocalTarget(target),href=documentHref(missionId,local);
    return stash(href?`<a class="file-reference" href="${escapeHtml(href)}" target="_self" rel="noopener noreferrer" title="预览 ${escapeHtml(local.path)}">${safeLabel} ↗</a>`:`<span title="${escapeHtml(target)}">${safeLabel}</span>`);
  });
  text=escapeHtml(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/^#{1,3} (.+)$/gm,'<strong>$1</strong>');
  const restore=html=>html.replace(/\u0000BLOCK(\d+)\u0000/g,(_,index)=>blocks[Number(index)]||'');
  return restore(restore(text));
}
