// One-time historical appearance migration. Stop the office service before --apply.
import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {normalizeRoleAvatars} from '../src/mission-avatars.js';

const cast=normalizeRoleAvatars({boss:'hiruzen-custom',tech:'naruto-custom',builder:'tsunade-custom',ops:'sakura-custom'});
const file=new URL('../.office-data/missions.json',import.meta.url),beforeBytes=readFileSync(file),before=JSON.parse(beforeBytes);
const hash=value=>createHash('sha256').update(value).digest('hex');
const active=new Set(['starting','running','queued','waiting','stopping','suspending']);
assert.ok(before.every(m=>!active.has(m.status)&&m.agents.every(a=>!active.has(a.status))), 'A session is active; leave its data untouched.');
const after=before.map(m=>({...m,roleAvatars:{...cast}}));
const withoutCast=missions=>missions.map(({roleAvatars,...rest})=>rest);
assert.deepEqual(withoutCast(after),withoutCast(before));
const summary={total:before.length,changed:before.filter(m=>JSON.stringify(m.roleAvatars)!==JSON.stringify(cast)).length,cast,messages:before.reduce((sum,m)=>sum+m.messages.length,0),agents:before.reduce((sum,m)=>sum+m.agents.length,0)};
if(!process.argv.includes('--apply')){console.log(JSON.stringify({...summary,dryRun:true},null,2));process.exit(0);}
let listening=false;
try{listening=Boolean(execFileSync('/usr/sbin/lsof',['-nP','-iTCP:4317','-sTCP:LISTEN'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());}catch(error){if(error.status!==1)throw error;}
assert.equal(listening,false,'Stop the live office service before editing its persisted data.');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=new URL(`../.office-data/backups/cast-${stamp}/`,import.meta.url);
mkdirSync(backup,{recursive:true,mode:0o700});
writeFileSync(new URL('missions.json',backup),beforeBytes,{mode:0o600,flag:'wx'});
const projects=new URL('../.office-data/projects.json',import.meta.url);
if(existsSync(projects))writeFileSync(new URL('projects.json',backup),readFileSync(projects),{mode:0o600,flag:'wx'});
assert.equal(hash(readFileSync(file)),hash(beforeBytes),'Data changed during migration; abort.');
const temp=new URL('../.office-data/missions.json.cast-migration.tmp',import.meta.url);
writeFileSync(temp,JSON.stringify(after),{mode:0o600,flag:'wx'});renameSync(temp,file);
const persisted=JSON.parse(readFileSync(file));assert.deepEqual(persisted,after);
const result={...summary,backup:fileURLToPath(backup),beforeSha256:hash(beforeBytes),afterSha256:hash(readFileSync(file)),preservedHistory:true};
writeFileSync(new URL('migration.json',backup),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify(result,null,2));
