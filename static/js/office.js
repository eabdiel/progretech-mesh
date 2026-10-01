(() => {
  const $ = id => document.getElementById(id);
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let snapshot = null, selected = null, positions = {}, manualPositions = {}, zoom = 1, pending = false, online = false, hostEpoch = 0;
  let basePositions={}, selectedLink=null, fleet=[], runtimeState=null, powerBusy=false, mailboxEpoch=0;
  const conversations=new Map();
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
    live.forEach((a,i)=>{positions[a.id]=manualPositions[a.id] || {x:140+(i%4)*240,y:505+Math.floor(i/4)*115};});
    basePositions=Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{...p}]));
    $('floorNodes').innerHTML = display.map(a => {
      const blocked = snapshot.tasks.some(t => t.assignee===a.id && t.status==='blocked');
      const state = a.last_result?.severity==='error' ? 'error' : blocked ? 'blocked' : a.state;
      const p = positions[a.id];
      return `<button class="floor-node ${a.isDirector?'director':''} ${state==='active'?'working':escape(state)} ${a.id===selected?'selected':''}" data-agent="${escape(a.id)}" ${a.factoryObserved?'data-factory-role="'+escape(a.id.slice(8))+'"':''} style="left:${p.x}px;top:${p.y}px" aria-label="${escape(a.name)}, ${escape(a.role)}, ${escape(state)}"><span class="node-orb">${a.isDirector?'◈':escape(a.name.slice(0,2).toUpperCase())}</span><span class="node-state" aria-hidden="true"></span><span class="node-name">${escape(a.name)} · ${escape(state)}</span><span class="node-role">${escape(a.role)}</span></button>`;
    }).join('');
    $('floorNodes').querySelectorAll('[data-agent]').forEach(node => {
      node.onclick = () => { if (node.dataset.dragged==='true') {node.dataset.dragged='false'; return;} selected=node.dataset.agent;selectedLink=null;runtimeState=null; renderInspector(); renderFloor(); if(node.dataset.factoryRole)loadRuntime();else loadMailbox(); };
      node.onpointerdown = e => {
        if(e.button!==0)return;
        const start={x:e.clientX,y:e.clientY},id=node.dataset.agent,original={...positions[id]};
        const scale=Math.min($('officeFloor').clientWidth/1000,$('officeFloor').clientHeight/700)*zoom;
        node.setPointerCapture(e.pointerId);
        node.onpointermove = move => {if(Math.hypot(move.clientX-start.x,move.clientY-start.y)<4)return;node.dataset.dragged='true';manualPositions[id]=positions[id]={x:Math.max(80,Math.min(920,original.x+(move.clientX-start.x)/scale)),y:Math.max(90,Math.min(600,original.y+(move.clientY-start.y)/scale))};node.style.left=positions[id].x+'px';node.style.top=positions[id].y+'px';renderLinks();};
        node.onpointerup=()=>{node.onpointermove=null;if(node.dataset.dragged!=='true')return;try{manualPositions[id]={...positions[id]};sessionStorage.setItem('mesh-office-layout:'+host(),JSON.stringify(manualPositions));}catch{}};
      };
    });
    renderLinks(); fit();
  }
  function geometry(link,t=0) {
    const a=positions[link.from],b=positions[link.to];if(!a||!b)return '';
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
    if(link.kind==='instruction')return `M${a.x} ${a.y-20} L${b.x} ${b.y-20}`;
    let d=`M${a.x} ${a.y-20}`;
    for(let i=1;i<=36;i++){const u=i/36,wiggle=Math.sin(u*Math.PI*8+t)*7*Math.sin(Math.PI*u);d+=` L${a.x+dx*u-dy/length*wiggle} ${a.y-20+dy*u+dx/length*wiggle}`;}
    return d;
  }
  function showInteraction(link) {
    selectedLink=link.id;
    const panel=$('interactionDetails');panel.hidden=false;
    const names=id=>snapshot.agents.find(a=>a.id===id)?.name || id.replace('factory-','');
    panel.innerHTML=`<h3>${link.kind==='instruction'?'Instruction / handoff':'Shared task'}</h3><p>${escape(link.title)}${link.task_id?'<br>'+escape(link.task_id):''}</p><p>${escape(names(link.from))}${link.kind==='instruction'?' → ':' ↔ '}${escape(names(link.to))}</p>${[link.from,link.to].map(id=>`<p><strong>${escape(names(id))}</strong><br>${escape(link.parts?.[id] || 'Specific task part not reported.')}</p>`).join('')}<p>${escape(link.source || 'Recorded activity')}</p>`;
  }
  function renderLinks() {
    const links=snapshot.interactions || [];
    $('floorLinks').innerHTML='<defs><marker id="instructionArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#62d6ed"/></marker></defs>'+links.filter(l=>positions[l.from]&&positions[l.to]).map(l=>`<path tabindex="0" role="button" aria-label="${escape(l.kind+': '+l.title)}" data-interaction="${escape(l.id)}" class="floor-link ${l.kind==='instruction'?'instruction':'collaboration'}" ${l.kind==='instruction'?'marker-end="url(#instructionArrow)"':''} d="${geometry(l)}"><title>${escape(l.title)}</title></path>`).join('');
    $('floorLinks').querySelectorAll('[data-interaction]').forEach(path=>{
      const open=()=>showInteraction(links.find(l=>l.id===path.dataset.interaction));path.onclick=open;
      path.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}};
    });
    if(selectedLink){const link=links.find(l=>l.id===selectedLink);if(link)showInteraction(link);else{$('interactionDetails').hidden=true;selectedLink=null;}}
    else $('interactionDetails').hidden=true;
  }
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let animation;
  function float(time) {
    if(snapshot && !document.hidden && !reduced.matches) {
      $('floorNodes').querySelectorAll('[data-agent]').forEach((node,i)=>{
        const id=node.dataset.agent,p=basePositions[id];if(!p || manualPositions[id] || node.matches(':focus,:hover'))return;
        positions[id]={x:p.x+Math.sin(time/3400+i*1.7)*10,y:p.y+Math.cos(time/4200+i*1.7)*7};
        node.style.left=positions[id].x+'px';node.style.top=positions[id].y+'px';
      });
      const links=snapshot.interactions||[];
      $('floorLinks').querySelectorAll('[data-interaction]').forEach(path=>{const l=links.find(l=>l.id===path.dataset.interaction);if(l)path.setAttribute('d',geometry(l,time/900));});
    }
    animation=requestAnimationFrame(float);
  }
  animation=requestAnimationFrame(float);
  function renderInspector() {
    const live=snapshot?.factoryAgents?.find(a=>'factory-'+a.id===selected);
    const a=live ? {...live,name:live.id[0].toUpperCase()+live.id.slice(1),role:'Local agent'} : snapshot?.agents.find(a=>a.id===selected);
    $('factoryChat').hidden=!live;
    $('officeMailbox').hidden=!a || Boolean(live);
    if(live)renderConversation();
    $('inspectorActions').hidden=!a || Boolean(live);
    $('inspectorName').textContent=a?.name || 'Choose an agent';
    $('inspectorRole').textContent=a ? `${a.role} · ${a.state} · ${live ? (live.sleeping?'asleep':'awake') : a.pendingMessages+' mailbox messages'}` : 'Select a circle to follow its work and send guidance.';
    $('inspectorGoal').textContent=a?.goal || '';
    $('archiveWorker').disabled=!a || a.isDirector || Boolean(live) || !online;
    $('officeActivity').innerHTML=(snapshot?.events || []).filter(e=>!selected||e.agentId===selected||e.from===selected||e.to===selected).slice(-10).reverse().map(e=>`<li>${escape(e.kind)}${e.summary?'<br>'+escape(e.summary):''}${e.taskId?'<br>'+escape(e.taskId):''}</li>`).join('') || (live ? `<li>${escape(live.state)}${live.task_id?'<br>'+escape(live.task_id):''}${live.last_result?.severity==='error'?'<br>Last reply failed: '+escape(live.last_result.code):''}</li>` : '<li>No recent activity.</li>');
    if(live && !powerBusy) {if(runtimeState)runtimeState.sleeping=live.sleeping;const asleep=live.sleeping;$('factoryPower').textContent=asleep?'Wake up':'Sleep';$('factoryPower').disabled=asleep===null || !online;$('factoryPowerStatus').textContent=asleep===null?'Availability unknown':asleep?'Asleep in Mesh and Factory':'Awake in Mesh and Factory';}
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
    $('officeAgentCount').textContent=snapshot.agents.length+(snapshot.factoryAgents?.length||0);
    $('officeTaskCount').textContent=snapshot.tasks.filter(t=>t.status!=='done').length;
    $('officeMessageCount').textContent=snapshot.messages.length;
    $('officeRuntimeNotice').textContent=document.body.dataset.offline?snapshot.runtimeReady?'Your local GGUF model runs through the bundled inference engine. Linked workers can delegate to your imported agents. Pausing stops work at the next agent step.':'Choose a GGUF model in Mission Control to execute missions. You can hire workers and organize missions now.':snapshot.runtimeReady?'CrewAI is configured on this host. Missions use its model and approved workspace. Pausing stops work at the next agent step.':'CrewAI execution needs setup on this host. Office coordination is available; see docs/FACTORY_OFFICE.md.';
    if(document.activeElement!==$('maxIterations'))$('maxIterations').value=snapshot.maxIterations;
    renderFloor();renderBoard();renderInspector();
  }
  const selectedRuntime=()=>{
    const row=snapshot?.factoryAgents?.find(a=>'factory-'+a.id===selected);
    if(!row || !row.runtime_id)return null;
    return fleet.find(a=>a.control_center_gateway===host() && a.runtime_id===row.runtime_id)?.id || fleet.find(a=>a.id===host()+'--'+row.runtime_id)?.id;
  };
  async function loadRuntime() {
    const id=selected;try{const response=await fetch('/api/status');const data=await response.json();fleet=data.agents||[];const aid=selectedRuntime();if(!aid)throw Error('Enroll this signed agent in the fleet to use live chat and wake controls.');const state=await MeshRuntime.request(aid,'runtime.status');if(selected===id){runtimeState=state;renderInspector();}}
    catch(e){if(selected===id){$('factoryPower').disabled=true;$('factoryPowerStatus').textContent=e.message;}}
  }
  function renderConversation() {
    $('factoryConversation').innerHTML=(conversations.get(selected)||[]).map(m=>`<li class="${m.error?'chat-error':''}"><strong>${escape(m.sender)}</strong><br>${escape(m.text)}</li>`).join('') || '<li>No conversation in this tab yet.</li>';
  }
  $('factoryMessage').onsubmit=async e=>{
    e.preventDefault();const aid=selectedRuntime(),id=selected;if(!aid){say('Enroll this role in the fleet first.');return;}
    const text=e.target.elements.text.value.trim();if(!text)return;
    const rows=conversations.get(id)||[];conversations.set(id,rows);rows.push({sender:'You',text});const reply={sender:id.slice(8),text:'Requesting host…'};rows.push(reply);if(rows.length>80)rows.splice(0,rows.length-80);e.target.reset();renderConversation();
    try{const result=await MeshRuntime.run(aid,'communication.start',{text},job=>{reply.text=job.detail;if(selected===id)renderConversation();});reply.text=result.reply;}
    catch(e){reply.text=e.message;reply.error=true;}
    if(selected===id)renderConversation();refresh();
  };
  $('factoryPower').onclick=async()=>{
    const aid=selectedRuntime(),id=selected;if(!aid)return;powerBusy=true;$('factoryPower').disabled=true;
    try{const state=await MeshRuntime.run(aid,snapshot.factoryAgents.find(a=>'factory-'+a.id===id)?.sleeping?'runtime.wake':'runtime.sleep',{},j=>{if(selected===id)$('factoryPowerStatus').textContent=j.detail;});if(selected===id)runtimeState=state;}
    catch(e){say(e.message);}finally{powerBusy=false;refresh();}
  };
  $('factoryNewChat').onclick=async()=>{try{await MeshRuntime.request(selectedRuntime(),'communication.new');say('New conversation ready; previous runtime history is preserved.');}catch(e){say(e.message);}};
  for(const kind of ['Task','Terminal'])$('factory'+kind+'Snapshot').onclick=async()=>{
    const id=selected;try{const result=await MeshRuntime.request(selectedRuntime(),'runtime.snapshot',{kind:kind.toLowerCase()});const rows=conversations.get(id)||[];conversations.set(id,rows);rows.push({sender:'Host',text:result.lines.join('\n')});if(selected===id)renderConversation();}catch(e){say(e.message);}
  };
  async function loadMailbox() {
    const id=selected,epoch=++mailboxEpoch;if(!id || id.startsWith('factory-'))return;
    try{const result=await api('mailbox.list',{agent:id});const data=result.result;if(id!==selected || epoch!==mailboxEpoch)return;
      $('mailboxItems').innerHTML=data.pending.map(m=>`<li><strong>${escape(m.subject)}</strong><p>${escape(m.body)}</p><small>Pending · priority ${m.priority||0}</small><div><button data-mail-edit="${escape(m.id)}">Edit</button><button data-mail-priority="${escape(m.id)}" data-priority="${Math.min(100,(m.priority||0)+1)}">Raise priority</button><button data-mail-priority="${escape(m.id)}" data-priority="${Math.max(-100,(m.priority||0)-1)}">Lower priority</button><button data-mail-remove="${escape(m.id)}">Remove</button></div></li>`).join('')||'<li>No pending items.</li>';
      $('mailboxHistory').innerHTML=data.history.map(m=>`<li><strong>${escape(m.subject)}</strong><p>${escape(m.body)}</p><small>Delivered context · ${escape(m.created_at)}</small></li>`).join('')||'<li>No delivered items.</li>';
      $('mailboxItems').querySelectorAll('button').forEach(b=>b.onclick=async()=>{
        const mid=b.dataset.mailEdit||b.dataset.mailRemove||b.dataset.mailPriority;
        const action=b.dataset.mailEdit?'mailbox.edit':b.dataset.mailRemove?'mailbox.remove':'mailbox.priority';const args={agent:id,id:mid};
        if(action==='mailbox.edit'){const text=prompt('Edit pending mailbox item',data.pending.find(m=>m.id===mid).body);if(text===null || !text.trim())return;args.text=text;}
        if(action==='mailbox.priority')args.priority=Number(b.dataset.priority);
        b.disabled=true;try{await api(action,args);loadMailbox();}catch(e){say(e.message);b.disabled=false;}
      });
    }catch(e){if(selected===id)$('mailboxItems').textContent=e.message;}
  }
  async function refresh() {
    if(pending)return;pending=true;const epoch=hostEpoch;
    try{const result=await api('snapshot');if(epoch!==hostEpoch)return;snapshot=result.snapshot;online=true;render();if(selected && !selected.startsWith('factory-'))loadMailbox();say(snapshot.paused?'Office paused · coordination remains available':'Office connected · live state from your host');}
    catch(e){if(epoch!==hostEpoch)return;online=false;$('officeSignal').classList.remove('online');say(e.message);for(const id of ['openHire','openMission','officePause','saveOfficeSettings'])$(id).disabled=true;if(snapshot){snapshot.agents.forEach(a=>a.state='offline');render();}}
    finally{pending=false;}
  }
  $('officeHost').onchange=()=>{hostEpoch++;mailboxEpoch++;runtimeState=null;conversations.clear();selectedLink=null;snapshot=null;selected=null;online=false;positions={};manualPositions={};$('floorNodes').replaceChildren();$('floorLinks').replaceChildren();$('floorEmpty').hidden=false;try{manualPositions=JSON.parse(sessionStorage.getItem('mesh-office-layout:'+host())||'{}');}catch{}refresh();};
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
  refresh();const timer=setInterval(refresh,4000);window.addEventListener('pagehide',()=>{clearInterval(timer);cancelAnimationFrame(animation);});
})();
