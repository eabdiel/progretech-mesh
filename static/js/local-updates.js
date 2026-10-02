'use strict';
(() => {
  const button=document.getElementById('localUpdateCheck');if(!button)return;
  const dialog=document.createElement('dialog');dialog.className='mesh-update-dialog';
  const title=document.createElement('h2');title.textContent='Local Mesh updates';
  const notice=document.createElement('p');notice.setAttribute('role','status');
  const changes=document.createElement('pre');const apply=document.createElement('button');apply.textContent='Install update';apply.hidden=true;
  const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();
  dialog.append(title,notice,changes,apply,close);document.body.append(dialog);
  let target=null,timer=null;
  async function request(body){const response=await fetch('/api/local-updates',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok||data.ok===false)throw Error((data.error||'Update unavailable').replaceAll('_',' '));return data;}
  function render(data){target=data.offer?.target;const phase=data.job?.phase;const busy=['queued','preparing','installing','restarting'].includes(phase);apply.hidden=!data.offer?.available||busy;apply.disabled=false;notice.textContent=busy?`Updating: ${phase}…`:data.offer?.available?`Update available. Installed: ${data.installed}. Channel: ${data.channel}.${phase==='failed'?' Last attempt stopped: '+(data.job.error||'unknown reason').replaceAll('_',' ')+'.':''}`:phase==='failed'?`Update stopped: ${(data.job.error||'unknown reason').replaceAll('_',' ')}.`:`Mesh ${data.version} is up to date.`;changes.textContent=(data.offer?.commits||[]).join('\n');return busy;}
  async function poll(){try{if(render(await request()))timer=setTimeout(poll,2000);}catch{notice.textContent='Mesh is restarting. Reconnecting…';timer=setTimeout(poll,2000);}}
  button.onclick=async()=>{clearTimeout(timer);dialog.showModal();button.disabled=true;apply.hidden=true;notice.textContent='Checking Git for updates…';try{render(await request({action:'check'}));}catch(e){notice.textContent=e.message;}finally{button.disabled=false;}};
  apply.onclick=async()=>{apply.disabled=true;try{const busy=render(await request({action:'install',target}));if(busy)timer=setTimeout(poll,2000);}catch(e){notice.textContent=e.message;apply.disabled=false;}};
})();
