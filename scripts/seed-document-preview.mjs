// Generate disposable documents and a saved idle chat, without invoking models.
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {MissionService} from '../server/missions.js';

const directory=mkdtempSync(path.join(tmpdir(),'office-document-preview-')),cwd=path.join(directory,'project'),store=path.join(directory,'store');mkdirSync(cwd);mkdirSync(path.join(cwd,'docs'));mkdirSync(path.join(cwd,'src'));
const report='# 本地文档预览\n\n这是一份 **模拟验收文档**，用于检查浏览器渲染。\n\n## 验收清单\n\n- 中文和空格文件名\n- 标题、列表、表格和代码块\n- [进入下一页](./next.md#下一节)\n\n| 项目 | 结果 |\n| --- | --- |\n| Markdown | 可渲染 |\n| 相对链接 | 可跳转 |\n\n```js\nconsole.log("本地只读预览");\n```\n\n[定位本节](#验收清单)\n';
writeFileSync(path.join(cwd,'docs','报告 (最终).md'),report);writeFileSync(path.join(cwd,'docs','next.md'),'# 下一页\n\n## 下一节\n\n相对链接已正确定位。\n\n[返回报告](<./报告 (最终).md>)\n');
writeFileSync(path.join(cwd,'report.html'),'<!doctype html><html><head><style>body{background:#eef3e8;color:#465c3e}h1{color:#8c622f}.card{padding:24px;border:1px solid #b9caa4;border-radius:12px;background:white}</style></head><body><h1>HTML 文档预览</h1><div class="card"><p>样式保留，脚本禁用。</p><a href="docs/next.md">打开本地 Markdown</a></div></body></html>');
writeFileSync(path.join(cwd,'safety.html'),'<h1>安全预览测试</h1><p>应保留正文，不执行脚本或跳转。</p><script>document.body.textContent="SCRIPT_RAN_MARKER";</script><meta http-equiv="refresh" content="0;url=http://127.0.0.1:4319"><iframe src="http://127.0.0.1:4319"></iframe><img src="http://127.0.0.1:4319/tracker.png" onerror="document.body.textContent=\'HANDLER_RAN_MARKER\'"><a href="javascript:alert(1)">危险链接应不可执行</a><form action="http://127.0.0.1:4319"><button>不应出现的提交按钮</button></form>');
writeFileSync(path.join(cwd,'src','example.js'),'// 模拟源码\nconst one = 1;\nconst two = 2;\nconsole.log(one + two);\n');writeFileSync(path.join(cwd,'.env'),'DUMMY_PREVIEW_SECRET=NOT_A_REAL_KEY');writeFileSync(path.join(directory,'outside.txt'),'Outside the allowed project');
const bridge=new EventEmitter();bridge.request=async()=>{throw Error('Fixture must not start models');};
const service=new MissionService(bridge,{directory:store,defaultCwd:cwd}),project=await service.createProject({cwd,name:'文档预览验证'}),m=await service.create({kind:'chat',projectId:project.id});m.title='本地文档超链验证（模拟）';
service.message(m,m.agents[0].id,`以下均为模拟文件，用来验证文档超链：\n\n- [中文 Markdown 报告](<${path.join(cwd,'docs','报告 (最终).md')}>)\n- [HTML 报告](report.html)\n- [源码第 3 行](src/example.js:3)\n- [HTML 安全测试](safety.html)\n- [不存在的文件](missing.md)\n- [越界路径（应拒绝）](../outside.txt)\n- [隐藏配置（应拒绝）](.env)\n`,'assistant');
m.files.push({path:path.join(cwd,'docs','报告 (最终).md'),status:'observed',source:'workspace',content:report});service.save();clearTimeout(service.saveTimer);clearTimeout(service.broadcastTimer);
console.log(JSON.stringify({directory,store,cwd,missionId:m.id,modelTurns:0}));
