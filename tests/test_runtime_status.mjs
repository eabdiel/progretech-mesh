import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const context={window:{},Date,setTimeout};vm.runInNewContext(readFileSync(new URL('../static/js/runtime-client.js',import.meta.url),'utf8'),context);const api=context.window.MeshRuntime;
test('fleet and Factory use identical state and last-event color',()=>{
 const fleet=[{id:'rend--coder',runtime_id:'coder',state:'idle',transport:'connected',mesh_runtime:{sleeping:false},last_event:{type:'heartbeat',payload:{}}}];
 const floor=api.factoryAgent({id:'mak',runtime_id:'coder',state:'unknown'},fleet,'rend');
 assert.equal(api.indicator(floor).state,api.indicator(fleet[0]).state);assert.equal(api.indicator(floor).state,'monitoring');
 assert.equal(api.terminalDirection(fleet[0].last_event).label,'SYS');
});
test('offline and asleep do not show misleading successful activity',()=>{
 assert.equal(api.indicator({state:'working',transport:'not-connected',last_event:{type:'message_response'}}).label,'Offline');
 assert.equal(api.indicator({state:'idle',mesh_runtime:{sleeping:true}}).state,'sleeping');
 assert.equal(api.indicator({state:'unknown'}).label,'Activity unknown');
});
test('terminal and lamp use the same direction classification',()=>{
 for(const [event,label,state] of [[{type:'heartbeat'},'SYS','monitoring'],[{type:'message_response'},'IN','success'],[{type:'user_message'},'OUT','busy'],[{type:'direct_error'},'ERR','error'],[{type:'file_offer'},'FILE','warning']]){
  assert.equal(api.terminalDirection(event).label,label);assert.equal(api.indicator({state:'idle',transport:'connected',last_event:event}).state,state);
 }
});
