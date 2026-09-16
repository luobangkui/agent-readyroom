import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const preload=fileURLToPath(new URL('../scripts/service-lifecycle.mjs',import.meta.url));
const run=code=>spawnSync(process.execPath,['--unhandled-rejections=strict','--import',preload,'--eval',code],{encoding:'utf8',timeout:5000});
const records=output=>output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
test('service lifecycle logs startup and normal exit without running a model',()=>{
  const result=run('');assert.equal(result.status,0);const events=records(result.stdout);assert.deepEqual(events.map(e=>e.event),['start','exit']);assert.equal(events[1].code,0);assert.ok(events.every(e=>Number.isInteger(e.pid)&&e.time));
});
test('service lifecycle observes fatal errors but does not swallow them',()=>{
  const result=run('throw new Error("fixture-fatal")');assert.equal(result.status,1);const events=records(result.stderr);assert.equal(events[0].event,'fatal');assert.equal(events[0].message,'fixture-fatal');assert.equal(events[1].event,'exit');assert.equal(events[1].code,1);
});
test('service lifecycle keeps unhandled rejection fatal for launchd recovery',()=>{
  const result=run('Promise.reject(new Error("fixture-rejection"))');assert.equal(result.status,1);assert.ok(records(result.stderr).some(e=>e.event==='fatal'&&e.origin==='unhandledRejection'));
});
test('service lifecycle preserves application signal handling',()=>{
  const result=run('process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>{},1000); process.kill(process.pid,"SIGTERM")');assert.equal(result.status,0);assert.deepEqual(records(result.stdout).map(e=>e.event),['start','signal','exit']);
});
