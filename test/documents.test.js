import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readDocument,documentPath,TEXT_PREVIEW_LIMIT,FILE_DOWNLOAD_LIMIT} from '../server/documents.js';
import {parseLocalTarget,formatMessage,documentHref,localFileLink} from '../src/document-links.js';

function fixture(t){const root=mkdtempSync(path.join(tmpdir(),'office-doc-test-')),cwd=path.join(root,'project');mkdirSync(cwd);t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,cwd,m:{id:'mission_1234abcd',cwd}};}
test('local document targets support spaces, Unicode, parentheses, URI encoding and line numbers',()=>{
  assert.deepEqual(parseLocalTarget('</Users/test/My Project/方案(最终).md:12>'),{path:'/Users/test/My Project/方案(最终).md',line:12,anchor:''});
  assert.deepEqual(parseLocalTarget('file:///Users/test/My%20Project/a.md#L9'),{path:'/Users/test/My Project/a.md',line:9,anchor:''});
  assert.deepEqual(parseLocalTarget('README.md:4:2'),{path:'README.md',line:4,anchor:''});
  assert.deepEqual(parseLocalTarget('../next.md#中文章节','docs/chapter/intro.md'),{path:'docs/chapter/../next.md',line:null,anchor:'中文章节'});
  assert.deepEqual(parseLocalTarget('notes%23one.md'),{path:'notes#one.md',line:null,anchor:''});
  for(const value of ['javascript:alert(1)','data:text/html,test','file://other-host/share/a.md','//external/path','~/private.md',''])assert.equal(parseLocalTarget(value),null);
});
test('document URLs safely round-trip special filenames and anchors',()=>{
  const target={path:'/test/a #文档(1).md',line:7,anchor:'中文 标题'},url=new URL(documentHref('mission_1234abcd',target),'http://localhost');
  assert.equal(url.searchParams.get('path'),target.path);assert.equal(url.searchParams.get('line'),'7');assert.equal(decodeURIComponent(url.hash.slice(1)),target.anchor);
  assert.match(localFileLink('m','a#b.md'),/path=a%23b.md/);
});
test('chat document links become anchors without converting code examples or trusting HTML',()=>{
  const html=formatMessage('[文档](</Users/test/My Project/方案(最终).md:12>) [另一个](docs/a(1).md) [带标题](<docs/a.md> "报告")','mission_1234abcd');
  assert.match(html,/target="_self"/);
  assert.equal((html.match(/class="file-reference"/g)||[]).length,3);assert.match(html,/line=12/);assert.match(html,/docs%2Fa%281%29.md/);
  const code=formatMessage('`[代码](README.md)`\n```md\n[示例](example.md)\n```','m');assert.ok(!code.includes('<a '));assert.match(code,/message-code/);
  assert.match(formatMessage('[`README.md`](README.md)','m'),/<code>README.md<\/code>/);
  const unsafe=formatMessage('<script>alert(1)</script> [坏链接](javascript:alert(1)) [<img src=x>](a.md)','m');assert.ok(!unsafe.includes('<script>'));assert.ok(!unsafe.includes('<img'));assert.equal((unsafe.match(/<a /g)||[]).length,1);
  assert.match(formatMessage('[网页](https://example.com/?a=1&b=2)','m'),/https:\/\/example.com\/\?a=1&amp;b=2/);
});
test('project documents are read without modifying them and raw content is a separate response',async t=>{
  const {cwd,m}=fixture(t);mkdirSync(path.join(cwd,'docs'));const file=path.join(cwd,'docs','方案 (最终).md');writeFileSync(file,'# 标题\n\n正文。');
  const info=await readDocument(m,file);assert.equal(info.kind,'markdown');assert.equal(info.path,'docs/方案 (最终).md');assert.match(info.content,/# 标题/);assert.equal(info.canDownload,true);
  const raw=await readDocument(m,'docs/方案 (最终).md',{raw:true});assert.equal(raw.data.toString(),'# 标题\n\n正文。');assert.equal(raw.content,undefined);
  writeFileSync(path.join(cwd,'report.html'),'<h1>报告</h1>');assert.equal((await readDocument(m,'report.html')).kind,'html');
});
test('preview refuses traversal, hidden secrets, out-of-project symlinks, folders and special targets',async t=>{
  const {root,cwd,m}=fixture(t);writeFileSync(path.join(root,'outside.txt'),'not accessible');writeFileSync(path.join(cwd,'.env'),'test-only');writeFileSync(path.join(cwd,'credential.json'),'test-only');
  symlinkSync(path.join(root,'outside.txt'),path.join(cwd,'alias.txt'));symlinkSync(path.join(cwd,'.env'),path.join(cwd,'hidden-alias.txt'));mkdirSync(path.join(cwd,'docs'));
  for(const file of ['../outside.txt',path.join(root,'outside.txt'),'.env','credential.json','alias.txt','hidden-alias.txt'])await assert.rejects(readDocument(m,file),error=>error.status===403);
  await assert.rejects(readDocument(m,'docs'),error=>error.status===400);await assert.rejects(readDocument(m,'missing.md'),error=>error.status===404);
  for(const invalid of ['',null,'a\0b','file:///etc/passwd'])await assert.rejects(documentPath(m,invalid),error=>error.status===400);
});
test('large text is bounded, binary data is not rendered as text, and oversized raw files are rejected',async t=>{
  const {cwd,m}=fixture(t);writeFileSync(path.join(cwd,'large.txt'),'a'.repeat(TEXT_PREVIEW_LIMIT+100));const large=await readDocument(m,'large.txt');assert.equal(large.truncated,true);assert.equal(large.content.length,TEXT_PREVIEW_LIMIT);
  writeFileSync(path.join(cwd,'binary.txt'),Buffer.from([65,0,66]));assert.equal((await readDocument(m,'binary.txt')).kind,'download');
  writeFileSync(path.join(cwd,'oversize.bin'),Buffer.alloc(FILE_DOWNLOAD_LIMIT+1));const big=await readDocument(m,'oversize.bin');assert.equal(big.canDownload,false);await assert.rejects(readDocument(m,'oversize.bin',{raw:true}),error=>error.status===413);
});
test('PDF magic is checked and SVG is shown as source rather than active markup',async t=>{
  const {cwd,m}=fixture(t);writeFileSync(path.join(cwd,'fake.pdf'),'<script>bad</script>');assert.equal((await readDocument(m,'fake.pdf')).kind,'download');
  writeFileSync(path.join(cwd,'header.pdf'),'%PDF-1.7\nfixture-header-only');assert.equal((await readDocument(m,'header.pdf')).kind,'pdf');
  writeFileSync(path.join(cwd,'drawing.svg'),'<svg onload="bad()"></svg>');assert.equal((await readDocument(m,'drawing.svg')).kind,'text');
});

test('special files are rejected without waiting for a FIFO writer', {skip:process.platform==='win32'},async t=>{
  const {cwd,m}=fixture(t);execFileSync('mkfifo',[path.join(cwd,'pipe.txt')]);await assert.rejects(readDocument(m,'pipe.txt'),error=>error.status===400);
});
