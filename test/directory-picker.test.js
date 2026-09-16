import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDirectory,pickDirectory} from '../server/directory-picker.js';

test('directory picker returns the selected absolute path and trims native output',async()=>{const calls=[];const cwd=await pickDirectory({platform:'darwin',run:async(...args)=>{calls.push(args);return {stdout:'/Users/example/project\n'};}});assert.equal(cwd,'/Users/example/project');assert.equal(calls[0][0],'osascript');});
test('directory picker maps cancel to a user-facing cancellation',async()=>{await assert.rejects(pickDirectory({platform:'darwin',run:async()=>{throw Object.assign(new Error('User canceled'),{code:-128});}}),error=>error.code==='USER_CANCELLED'&&error.status===409);});
test('empty native picker output is treated as cancellation',()=>{assert.throws(()=>normalizeDirectory(' \n '),error=>error.code==='USER_CANCELLED');});
