import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMessageKeydown} from '../src/message-input.js';

function press(fields={},canSend=true){let prevented=false,sent=0;const handled=handleMessageKeydown({key:'Enter',preventDefault(){prevented=true;},...fields},{canSend,send(){sent++;}});return {prevented,sent,handled};}
test('Enter sends once and prevents a newline',()=>assert.deepEqual(press(),{prevented:true,sent:1,handled:true}));
test('Shift+Enter and Alt+Enter retain native newline behavior',()=>{for(const modifier of ['shiftKey','altKey'])assert.deepEqual(press({[modifier]:true}),{prevented:false,sent:0,handled:false});});
test('IME composition and keyCode 229 do not send messages',()=>{for(const fields of [{isComposing:true},{keyCode:229},{key:'Process',keyCode:229}])assert.deepEqual(press(fields),{prevented:false,sent:0,handled:false});});
test('Ctrl+Enter and Command+Enter remain supported',()=>{for(const modifier of ['ctrlKey','metaKey'])assert.equal(press({[modifier]:true}).sent,1);});
test('held Enter is consumed without sending repeatedly',()=>assert.deepEqual(press({repeat:true}),{prevented:true,sent:0,handled:true}));
test('blank, disabled, or in-flight composer cannot send',()=>assert.deepEqual(press({},false),{prevented:true,sent:0,handled:true}));
test('other keys and already handled events are left alone',()=>{for(const fields of [{key:'a'},{key:'Escape'},{defaultPrevented:true}])assert.deepEqual(press(fields),{prevented:false,sent:0,handled:false});});
