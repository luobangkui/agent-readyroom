import {marked} from 'marked';
import createDOMPurify from 'dompurify';
import {documentHref,parseLocalTarget,escapeHtml} from './document-links.js';

const forbidden=['script','iframe','object','embed','form','base','meta','link','svg','math','video','audio','source','picture','canvas','textarea','select','button'];
const framePolicy="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export async function renderDocumentMarkup(info,{missionId,origin,anchor='',loadImage,createURL,document:doc=window.document}){
  const html=info.kind==='html',purify=createDOMPurify(doc.defaultView||window);
  const fragment=purify.sanitize(html?info.content:marked.parse(info.content,{gfm:true,async:false}),{RETURN_DOM_FRAGMENT:true,FORCE_BODY:true,USE_PROFILES:{html:true},FORBID_TAGS:html?forbidden:[...forbidden,'style'],FORBID_ATTR:html?['srcset','action','formaction','ping','autofocus']:['srcset','action','formaction','ping','autofocus','style','class','id','name']});
  for(const input of fragment.querySelectorAll('input')){if(input.type==='checkbox')input.disabled=true;else input.remove();}
  for(const link of fragment.querySelectorAll('a,area')){
    const href=link.getAttribute('href')||'';link.removeAttribute('download');link.removeAttribute('ping');
    if(href.startsWith('#')){link.removeAttribute('target');continue;}
    let target;
    if(/^https?:\/\//i.test(href)){try{target=new URL(href).href;}catch{}}
    else{const local=parseLocalTarget(href,info.path),next=documentHref(missionId,local);if(next)target=new URL(next,origin).href;}
    if(!target){link.removeAttribute('href');continue;}
    link.setAttribute('href',target);link.setAttribute('rel','noopener noreferrer');link.setAttribute('target',/^https?:\/\//i.test(href)?'_blank':html?'_top':'_self');
  }
  const pictures=[...fragment.querySelectorAll('img')];
  await Promise.all(pictures.map(async(img,index)=>{
    const source=img.getAttribute('src')||'';img.removeAttribute('src');img.removeAttribute('srcset');
    try{
      if(index>=20)throw Error('仅预览前 20 张图片');
      if(/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(source)){img.src=source;return;}
      if(/^[a-z][a-z\d+.-]*:/i.test(source)&&!/^file:/i.test(source)||source.startsWith('//'))throw Error('外部图片未加载');
      const target=parseLocalTarget(source,info.path);if(!target)throw Error('图片路径无效');img.src=await loadImage(target.path);img.loading='lazy';
    }catch(error){const note=doc.createElement('span');note.className='image-unavailable';note.textContent=`[${img.alt||'图片'}：${error.message}]`;img.replaceWith(note);}
  }));
  if(html){
    const wrapper=doc.createElement('div');wrapper.append(fragment);
    const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(framePolicy)}"><style>body{padding:24px;margin:0;font-family:system-ui,sans-serif;line-height:1.7;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{overflow:auto}table{max-width:100%}</style></head><body>${wrapper.innerHTML}</body></html>`;
    const iframe=doc.createElement('iframe');iframe.title='HTML 文档安全预览';iframe.className='document-frame';iframe.setAttribute('sandbox','allow-same-origin allow-top-navigation-by-user-activation allow-popups allow-popups-to-escape-sandbox');iframe.referrerPolicy='no-referrer';iframe.srcdoc=page;
    if(anchor)iframe.addEventListener('load',()=>{try{iframe.contentDocument?.getElementById(decodeURIComponent(anchor.slice(1)))?.scrollIntoView();}catch{}},{once:true});
    return iframe;
  }
  const article=doc.createElement('article');article.className='markdown-document';article.append(fragment);
  const slugs=new Map();for(const heading of article.querySelectorAll('h1,h2,h3,h4,h5,h6')){const base=heading.textContent.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^\p{L}\p{N}_-]/gu,'')||'section',count=slugs.get(base)||0;slugs.set(base,count+1);heading.id='doc-heading-'+base+(count?`-${count}`:'');}
  for(const link of article.querySelectorAll('a[href^="#"]')){let target;try{target=decodeURIComponent(link.getAttribute('href').slice(1));}catch{continue;}if([...article.querySelectorAll('[id]')].some(node=>node.id==='doc-heading-'+target))link.setAttribute('href','#doc-heading-'+target);}
  return article;
}
