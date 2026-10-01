/* Shared, factual host progress for the fleet and Factory. */
(() => {
  const errors = {
    mesh_agent_sleeping:'This agent is asleep. Wake it to send a message.',
    mesh_agent_busy:'This agent already has a request in progress.',
    mesh_context_limit:'The conversation exceeds the local model context. Start a new conversation; existing history is preserved.',
    mesh_provider_rejected:'The model rejected the request format or context. Try a new conversation. If it persists, check the local provider configuration.',
    mesh_provider_unavailable:'The local model provider is unavailable. Check the host connection.',
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
    const deadline=Date.now()+21*60*1000;
    while(true) {
      progress(job);
      if(job.done) {if(job.error)throw Error(errors[job.error] || job.error);return job.result;}
      if(Date.now()>deadline)throw Error('Progress polling timed out. The host request may still be running; check activity before sending again.');
      await new Promise(resolve=>setTimeout(resolve,1500));
      job=await request(agent,'communication.job',{job_id:job.job_id});
    }
  }
  window.MeshRuntime={request,run,errors};
})();
