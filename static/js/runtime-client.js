/* Shared, factual host progress for the fleet and Factory. */
(() => {
  const errors = {
    mesh_no_active_work:'No active work session is currently observed for this agent. Send chat or create a mission instead.',
    mesh_active_session_unavailable:'The host has no verified active session for this role.',
    mesh_context_delivery_unconfirmed:'Instruction delivery is unconfirmed. Check activity before sending it again; no automatic retry was sent.',
    mesh_agent_sleeping:'This agent is asleep. Wake it to send a message.',
    mesh_agent_busy:'This agent already has a request in progress.',
    mesh_context_limit:'The conversation exceeds the local model context. Start a new conversation; existing history is preserved.',
    mesh_provider_rejected:'The model rejected the request format or context. Try a new conversation. If it persists, check the local provider configuration.',
    mesh_provider_unavailable:'The earlier request could not reach or complete with the local model provider.',
    mesh_image_provider_unavailable:'No approved local image provider is active. No image was generated.',
    mesh_image_generation_failed:'Local image generation failed. No deliverable was published.',
    mesh_image_validation_failed:'The generated file failed image validation.',
    mesh_image_memory_headroom_required:'Image generation needs more available RAM.',
    mesh_image_review_model_unavailable:'No configured downloaded vision model is available for review.',
    mesh_image_brief_too_long:'Keep image-generation briefs under 1,200 characters.',
    mesh_reply_timeout:'The reply timed out. Check agent activity before sending again.',
    model_memory_headroom_required:'Not enough free memory to load this model alongside current models.',
    runtime_controls_unavailable:'Shared agent controls are unavailable on this host.',
    mesh_queue_timeout:'The shared model slot stayed busy. Check host activity.',
  };
  async function request(agent, action, args={}) {
    const r=await fetch(`/api/agents/${encodeURIComponent(agent)}/management`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args})});
    const d=await r.json();
    if(!r.ok || !d.ok) throw Error(errors[d.error] || d.error || 'Host request failed');
    return d.result;
  }
  async function run(agent,action,args={},progress=()=>{}) {
    let job=await request(agent,action,args);
    const deadline=Date.now()+(job.capability==='image_generation'?40:21)*60*1000;
    while(true) {
      progress(job);
      if(job.done) {if(job.error)throw Error(errors[job.error] || job.error);return job.result;}
      if(Date.now()>deadline)throw Error('Progress polling timed out. The host request may still be running; check activity before sending again.');
      await new Promise(resolve=>setTimeout(resolve,1500));
      job=await request(agent,'communication.job',{job_id:job.job_id});
    }
  }
  function indicator(agent, {monitoring=false}={}) {
    const runtime=agent.mesh_runtime || agent;
    const result=runtime.last_result || {};
    const labels={native_agent_failed:'The last native agent turn failed. This occurred outside this Mesh conversation; detailed provider diagnostics are unavailable here.',native_turn_complete:'The last native agent turn completed.',reply_received:'The last Mesh reply was received.'};
    const last=result.code ? `${labels[result.code] || errors[result.code] || result.code}${result.at ? ' Recorded '+new Date(result.at*1000).toLocaleString()+'.' : ''}` : '';
    // Current observed activity takes precedence over the last completed turn.
    if(monitoring)return {state:'monitoring',label:'Monitoring',detail:'Purple: passive host monitoring is active.'+(last?' Previous result: '+last:'')};
    if(runtime.sleeping)return {state:'sleeping',label:'Asleep',detail:'Amber: this agent is asleep in Mesh and Factory.'+(last?' Previous result: '+last:'')};
    if(['active','working','processing'].includes(agent.state))return {state:'busy',label:'Working',detail:'Blue: the host reports active work.'+(last?' Previous result: '+last:'')};
    const health=runtime.health;
    const healthAge=health?Date.now()/1000-health.checked_at:Infinity;
    const current=health?' Current check: gateway '+(health.gateway_reachable?'reachable':'unavailable')+', model provider '+(health.model_provider_reachable===true?'reachable':health.model_provider_reachable===false?'unavailable':'not verified')+(health.configured_model_installed===false?', configured model missing':'')+'.':'';
    const fresh=health?.state==='reachable' && health.checked_at>=Number(result.at||0) && healthAge>=-5 && healthAge<45;
    if(result.severity==='error' && result.code==='mesh_provider_unavailable' && fresh)return {state:'warning',label:'Previous request failed',detail:'Amber: '+last+' Current gateway and model provider are reachable; the configured model is installed. The failed request was not retried.'};
    if(result.severity==='error')return {state:'error',label:'Last action failed',detail:'Red: '+(last || 'The last Mesh request failed; see its error in this conversation.')+current};
    if(agent.transport && agent.transport!=='connected')return {state:'idle',label:'Offline',detail:'Gray: the gateway is offline.'+(last?' Previous result: '+last:'')};
    if(result.severity==='success')return {state:'success',label:'Last action completed',detail:'Green: '+(last || 'The last reply completed.')};
    return {state:'idle',label:'Idle',detail:'Gray: no current work or recorded result is reported.'};
  }
  function memoryLabel(memory={}) {
    if(memory.latest_status==='activity_write_unavailable')return 'MemPalace: last activity write failed'+(memory.at?' · '+new Date(memory.at).toLocaleString():'')+'.';
    if(memory.recall_verified && memory.memory_id)return 'MemPalace: saved and recall verified · '+(memory.activity_kind==='reviewed_activity'?'reviewed activity':memory.activity_kind==='runtime_activity'?'automatic runtime activity; reviewed summary missing':'continuity checkpoint')+(memory.at?' · '+new Date(memory.at).toLocaleString():'')+' · '+memory.memory_id;
    return 'MemPalace: no verified recent activity receipt observed'+(memory.latest_status && memory.latest_status!=='not_observed'?' · '+memory.latest_status:'')+'.';
  }
  async function recover(agent,progress=()=>{}) {
    const result=await run(agent,'runtime.recover',{},progress);
    return (result.steps || []).map(s=>s.name+' · '+s.state+': '+s.detail).join('\n')+'\n'+result.note;
  }
  window.MeshRuntime={request,run,errors,indicator,memoryLabel,recover};
})();
