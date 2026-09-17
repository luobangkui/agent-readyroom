import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanWorkspace,collectArtifacts} from '../server/artifacts.js';
import {trySymlink} from './fs-util.js';

test('artifact collection shows changed text files, excludes unchanged, hidden and linked content',async t=>{
 const cwd=await mkdtemp(path.join(os.tmpdir(),'office-artifacts-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(path.join(cwd,'old.md'),'existing');await writeFile(path.join(cwd,'.env'),'hidden');await mkdir(path.join(cwd,'node_modules'));await writeFile(path.join(cwd,'node_modules','dep.js'),'ignored');
 const baseline=await scanWorkspace(cwd);await writeFile(path.join(cwd,'result.md'),'actual output');await writeFile(path.join(cwd,'credentials.json'),'sensitive');
 if(!await trySymlink(path.join(cwd,'old.md'),path.join(cwd,'linked.md'))){t.skip('当前 Windows 环境不允许创建文件符号链接');return;}
 const mission={cwd,baseline,files:[],createdAt:new Date().toISOString()};await collectArtifacts(mission);
 assert.deepEqual(mission.files.map(f=>path.basename(f.path)),['result.md']);assert.equal(mission.files[0].content,'actual output');assert.equal(mission.files[0].source,'workspace');
});
