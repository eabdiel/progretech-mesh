(() => {
  const $ = id => document.getElementById(id);
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let snapshot = null, selected = null, positions = {}, manualPositions = {}, zoom = 1, pending = false, online = false, hostEpoch = 0;
  const host = () => $('officeHost').value;
  const say = text => { $('officeStatus').textContent = text; };
  async function api(operation, args = {}) {
    if (!host()) throw Error('Connect a personally hosted agent to open an office.');
    const response = await fetch(`/api/agents/${encodeURIComponent(host())}/office`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({operation,args})});
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.error || 'Office unavailable');
    return data.result;
  }
  function fit() {
    const floor = $('officeFloor');
    const scale = Math.min(floor.clientWidth / 1000, floor.clientHeight / 700) * zoom;
    $('floorWorld').style.setProperty('--node-scale', Math.min(2.1, Math.max(1, .7/scale)));
    $('floorWorld').style.transform = `translate(${(floor.clientWidth - 1000 * scale)/2}px,${(floor.clientHeight - 700 * scale)/2}px) scale(${scale})`;
  }
  function arrange() {
    const workers = snapshot.agents.filter(a => !a.isDirector);
    snapshot.agents.forEach(a => {
      const manual=manualPositions[a.id];
      if (manual && Number.isFinite(manual.x) && Number.isFinite(manual.y) && manual.x >= 80 && manual.x <= 920 && manual.y >= 90 && manual.y <= 600) { positions[a.id]={...manual}; return; }
      if (a.isDirector) positions[a.id] = {x:500,y:(snapshot.factoryAgents?.length ? 220 : 300)};
      else { const angle = 2*Math.PI*workers.findIndex(x => x.id===a.id)/Math.max(workers.length,1)-Math.PI/2; positions[a.id] = {x:500+310*Math.cos(angle),y:(snapshot.factoryAgents?.length ? 220+130*Math.sin(angle) : 340+225*Math.sin(angle))}; }
    });
  }
  function renderFloor() {
    arrange();
    $('floorEmpty').hidden = snapshot.agents.length + (snapshot.factoryAgents?.length || 0) > 0;
    const note=document.querySelector('.floor-footnote');if(note)note.hidden=Boolean(snapshot.factoryAgents?.length);
    const live=(snapshot.factoryAgents || []).map(a => ({...a,name:a.id[0].toUpperCase()+a.id.slice(1),role:'Live OpenClaw role',id:'factory-'+a.id,isDirector:false,factoryObserved:true}));
    const display=[...snapshot.agents,...live];
    live.forEach((a,i)=>{positions[a.id]={x:140+(i%4)*240,y:505+Math.floor(i/4)*125};});
    $('floorNodes').innerHTML = display.map(a => {
      const blocked = snapshot.tasks.some(t => t.assignee===a.id && t.status==='blocked');
      const state = blocked ? 'blocked' : a.state;
      const p = positions[a.id];
      return `<button class="floor-node ${a.isDirector?'director':''} ${state==='active'?'working':escape(state)} ${a.id===selected?'selected':''}" data-agent="${escape(a.id)}" ${a.factoryObserved?'data-factory-role="'+escape(a.id.slice(8))+'"':''} style="left:${p.x}px;top:${p.y}px" aria-label="${escape(a.name)}, ${escape(a.role)}, ${escape(state)}"><span class="node-orb">${a.isDirector?'◈':escape(a.name.slice(0,2).toUpperCase())}</span><span class="node-state" aria-hidden="true"></span><span class="node-name">${escape(a.name)} · ${escape(state)}</span><span class="node-role">${escape(a.role)}</span></button>`;
    }).join('');
    $('floorNodes').querySelectorAll('[data-agent]').forEach(node => {
      if(node.dataset.factoryRole) {
        node.onclick=async()=>{
          const action=window.prompt('Factory control: pause, stop, sleep, resume (Cancel to leave unchanged)');
          if(!['pause','stop','sleep','resume'].includes(action))return;
          const duration=action==='sleep'?window.prompt('Sleep duration, such as 30m','30m'):'1s';
          if(!duration)return;
          try {await api('workday.control',{action,role:node.dataset.factoryRole,duration});say('Factory control saved. Refreshing observed state.');}
          catch(error){say(error.message);}
        };
        return;
      }
      node.onclick = () => { if (node.dataset.dragged==='true') {node.dataset.dragged='false'; return;} selected=node.dataset.agent; renderInspector(); renderFloor(); };
      node.onpointerdown = e => {
        if(e.button!==0)return;
        const start={x:e.clientX,y:e.clientY},id=node.dataset.agent,original={...positions[id]};
        const scale=Math.min($('officeFloor').clientWidth/1000,$('officeFloor').clientHeight/700)*zoom;
        node.setPointerCapture(e.pointerId);
        node.onpointermove = move => {if(Math.hypot(move.clientX-start.x,move.clientY-start.y)<4)return;node.dataset.dragged='true';positions[id]={x:Math.max(80,Math.min(920,original.x+(move.clientX-start.x)/scale)),y:Math.max(90,Math.min(600,original.y+(move.clientY-start.y)/scale))};node.style.left=positions[id].x+'px';node.style.top=positions[id].y+'px';renderLinks();};
        node.onpointerup=()=>{node.onpointermove=null;try{manualPositions[id]={...positions[id]};sessionStorage.setItem('mesh-office-layout:'+host(),JSON.stringify(manualPositions));}catch{}};
      };
    });
    renderLinks(); fit();
  }
  function renderLinks() {
    const seen = new Set();
    $('floorLinks').innerHTML = snapshot.messages.slice(-30).map(m => {
      const to = m.to==='god' ? 'orchestrator' : m.to;
      const a=positions[m.from],b=positions[to],key=m.from+':'+to;
      if(!a||!b||seen.has(key))return '';seen.add(key);
      const recent = online && Date.now()-Date.parse(m.created_at)<30000;
      return `<path class="floor-link ${recent?'recent':''}" d="M${a.x} ${a.y-20} Q500 320 ${b.x} ${b.y-20}"/>`;
    }).join('');
  }
  function renderInspector() {
    const a=snapshot?.agents.find(a=>a.id===selected);
    $('inspectorActions').hidden=!a;
    $('inspectorName').textContent=a?.name || 'Choose an agent';
    $('inspectorRole').textContent=a ? `${a.role} · ${a.state} · ${a.pendingMessages} mailbox messages` : 'Select a circle to follow its work and send guidance.';
    $('inspectorGoal').textContent=a?.goal || '';
    $('archiveWorker').disabled=!a || a.isDirector || !online;
    $('officeActivity').innerHTML=(snapshot?.events || []).filter(e=>!selected||e.agentId===selected||e.from===selected||e.to===selected).slice(-10).reverse().map(e=>`<li>${escape(e.kind)}${e.summary?'<br>'+escape(e.summary):''}${e.taskId?'<br>'+escape(e.taskId):''}</li>`).join('') || '<li>No recent activity.</li>';
  }
  function renderBoard() {
    const labels={todo:'Queued',doing:'In progress',blocked:'Needs you',done:'Delivered'};
    $('officeBoard').innerHTML=Object.entries(labels).map(([state,label])=>{
      const tasks=snapshot.tasks.filter(t=>t.status===state);
      return `<div class="office-column"><h3>${label}<span>${tasks.length}</span></h3>${tasks.map(t=>{
        const dependencies=t.dependsOn.filter(id=>!snapshot.tasks.some(d=>d.id===id&&d.status==='done'));
        const assignee=snapshot.agents.find(a=>a.id===t.assignee)?.name || 'Director';
        return `<article class="mission-card ${state}"><strong>${escape(t.title)}</strong><p>${escape(assignee)}${dependencies.length?' · waiting on '+dependencies.length+' dependencies':''}</p><details><summary>Brief & result</summary><pre>${escape(t.description || '')}</pre>${t.result?'<pre>'+escape(t.result)+'</pre>':''}${(t.humanQA||[]).map(qa=>'<p>'+escape(qa.q)+(qa.a?'<br>'+escape(qa.a):'')+'</p>').join('')}</details>${state==='todo'?`<button data-run="${escape(t.id)}" ${!online||!snapshot.runtimeReady||snapshot.paused||dependencies.length||snapshot.agents.length<2?'disabled':''}>Start mission</button>`:state==='blocked'?`<button data-approve="${escape(t.id)}" ${!online?'disabled':''}>Approve & queue</button>`:''}</article>`;
      }).join('')||'<p class="muted">No missions</p>'}</div>`;
    }).join('');
    $('officeBoard').querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const result=await api('run',{id:b.dataset.run});say(`Mission queued · ${result.job_id}. Follow live activity on the floor.`);await refresh();}catch(e){say(e.message);b.disabled=false;}});
    $('officeBoard').querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('task.approve',{id:b.dataset.approve,answer:'Approved by the office owner in Mesh.'});await refresh();}catch(e){say(e.message);b.disabled=false;}});
  }
  function render() {
    $('officeSignal').classList.toggle('online',online);
    for(const id of ['openHire','openMission','officePause','saveOfficeSettings'])$(id).disabled=!online;
    $('officePause').textContent=snapshot.paused?'Resume office':'Pause office';
    $('officeAgentCount').textContent=snapshot.agents.length;
    $('officeTaskCount').textContent=snapshot.tasks.filter(t=>t.status!=='done').length;
    $('officeMessageCount').textContent=snapshot.messages.length;
    $('officeRuntimeNotice').textContent=document.body.dataset.offline?snapshot.runtimeReady?'Your local GGUF model runs through the bundled inference engine. Linked workers can delegate to your imported agents. Pausing stops work at the next agent step.':'Choose a GGUF model in Mission Control to execute missions. You can hire workers and organize missions now.':snapshot.runtimeReady?'CrewAI is configured on this host. Missions use its model and approved workspace. Pausing stops work at the next agent step.':'CrewAI execution needs setup on this host. Office coordination is available; see docs/FACTORY_OFFICE.md.';
    if(document.activeElement!==$('maxIterations'))$('maxIterations').value=snapshot.maxIterations;
    renderFloor();renderBoard();renderInspector();
  }
  async function refresh() {
    if(pending)return;pending=true;const epoch=hostEpoch;
    try{const result=await api('snapshot');if(epoch!==hostEpoch)return;snapshot=result.snapshot;online=true;render();say(snapshot.paused?'Office paused · coordination remains available':'Office connected · live state from your host');}
    catch(e){if(epoch!==hostEpoch)return;online=false;$('officeSignal').classList.remove('online');say(e.message);for(const id of ['openHire','openMission','officePause','saveOfficeSettings'])$(id).disabled=true;if(snapshot){snapshot.agents.forEach(a=>a.state='offline');render();}}
    finally{pending=false;}
  }
  $('officeHost').onchange=()=>{hostEpoch++;snapshot=null;selected=null;online=false;positions={};manualPositions={};$('floorNodes').replaceChildren();$('floorLinks').replaceChildren();$('floorEmpty').hidden=false;try{manualPositions=JSON.parse(sessionStorage.getItem('mesh-office-layout:'+host())||'{}');}catch{}refresh();};
  $('officeRefresh').onclick=refresh;
  $('zoomIn').onclick=()=>{zoom=Math.min(1.8,zoom+.15);fit();};$('zoomOut').onclick=()=>{zoom=Math.max(.6,zoom-.15);fit();};$('zoomReset').onclick=()=>{zoom=1;fit();};
  new ResizeObserver(fit).observe($('officeFloor'));
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  $('openHire').onclick=()=>$('hireDialog').showModal();
  $('openMission').onclick=()=>{
    $('missionForm').elements.assignee.innerHTML=snapshot.agents.map(a=>`<option value="${escape(a.id)}">${escape(a.name)} · ${escape(a.role)}</option>`).join('');
    $('missionForm').elements.dependsOn.innerHTML=snapshot.tasks.filter(t=>t.status!=='done').map(t=>`<option value="${escape(t.id)}">${escape(t.title)}</option>`).join('');
    $('missionDialog').showModal();
  };
  function formAction(id,operation,args) {
    $(id).onsubmit=async e=>{e.preventDefault();const form=e.target;const error=form.querySelector('.dialog-error');error.textContent='';form.querySelector('button[type="submit"],.primary-btn').disabled=true;try{await api(operation,args(form));form.closest('dialog').close();form.reset();await refresh();}catch(e){error.textContent=e.message;}finally{form.querySelector('button[type="submit"],.primary-btn').disabled=false;}};
  }
  formAction('hireForm','hire',f=>({name:f.elements.name.value,role:f.elements.role.value,goal:f.elements.goal.value}));
  formAction('missionForm','task.create',f=>({title:f.elements.title.value,description:f.elements.description.value,assignee:f.elements.assignee.value,dependsOn:[...f.elements.dependsOn.selectedOptions].map(o=>o.value),needsApproval:f.elements.needsApproval.checked}));
  formAction('memoryForm','memory.save',f=>({id:selected,text:f.elements.text.value}));
  $('officeMessage').onsubmit=async e=>{e.preventDefault();try{await api('message',{to:selected,text:e.target.elements.text.value});e.target.reset();await refresh();say('Message delivered to the office mailbox. It will be read with the next mission.');}catch(e){say(e.message);}};
  $('openMemory').onclick=async()=>{try{const result=await api('memory',{id:selected});$('memoryForm').elements.text.value=result.result.text;$('memoryDialog').showModal();}catch(e){say(e.message);}};
  $('archiveWorker').onclick=async()=>{try{await api('archive',{id:selected});selected=null;await refresh();}catch(e){say(e.message);}};
  $('officePause').onclick=async()=>{try{await api('pause',{paused:!snapshot.paused});await refresh();}catch(e){say(e.message);}};
  $('saveOfficeSettings').onclick=async()=>{try{await api('settings',{maxIterations:Number($('maxIterations').value)});await refresh();}catch(e){say(e.message);}};
  try{manualPositions=JSON.parse(sessionStorage.getItem('mesh-office-layout:'+host())||'{}');}catch{}
  refresh();const timer=setInterval(refresh,4000);window.addEventListener('pagehide',()=>clearInterval(timer));
})();
