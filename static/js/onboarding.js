(() => {
  const modal = document.createElement('dialog');
  modal.className = 'onboarding-dialog';
  modal.setAttribute('aria-labelledby', 'onboardingTitle');
  modal.innerHTML = `<div class="modal-head"><h2 id="onboardingTitle">Agent onboarding</h2><button type="button" data-close aria-label="Close onboarding">×</button></div>
    <form data-consent><ol><li><label><input type="checkbox" name="hosted" required> This is a personally hosted agent that I own or am authorized to connect.</label></li>
    <li><label><input type="checkbox" name="terms" required> I agree that Mesh is an intermediary. I am responsible for my agent’s instructions, actions, results and use through Mesh; ProgreTech does not operate my agent or guarantee its results.</label></li>
    <li><label>Agent name<input name="name" maxlength="80" required autocomplete="off"></label><p>Copy the invitation prompt into your existing authorized conversation with your agent.</p></li></ol><button class="primary-btn">Generate connection prompt</button></form>
    <section data-connect hidden><textarea data-prompt readonly rows="9" aria-label="Agent connection prompt"></textarea><button type="button" data-copy class="primary-btn">Copy prompt</button>
    <p><span class="onboarding-pulse" data-pulse aria-hidden="true"></span> <span data-connection>Waiting for agent connection</span></p>
    <form data-question><label>Ask your agent to identify itself<textarea name="text" maxlength="1000" required>Identify yourself: what is your name, role and runtime, and are you awake and ready to work?</textarea></label><button class="ghost-btn" disabled>Send question</button></form>
    <pre data-answer hidden></pre><div data-confirm-area hidden><p>Confirm that this reply identifies the agent you intended to connect. Mesh will register its public identity and issue its CodeSeal record. Its private PEM stays on its host.</p>
    <details><summary>Use my CodeSeal account</summary><label>CodeSeal API token<input type="password" data-token autocomplete="off" placeholder="ptcs_live_…"></label><small>Only needed when automatic issuance is unavailable. Cleared after submission.</small></details><button type="button" data-confirm class="primary-btn">Confirm identity & finish</button></div>
    <button type="button" data-cancel class="ghost-btn">Cancel invitation</button></section><p data-status role="status" aria-live="polite"></p>`;
  document.body.append(modal);
  const q = s => modal.querySelector(s);
  let id = null, timer = null, busy = false, opener = null, completed = false;
  const status = text => { q('[data-status]').textContent = text; };
  async function api(path, body) {
    const response = await fetch('/api/onboarding' + path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.error || 'Connection unavailable');
    return data;
  }
  function stop() { clearInterval(timer); timer = null; }
  async function poll() {
    if (!id || busy) return;
    busy = true;
    try {
      const data = await api('/' + id);
      q('[data-pulse]').classList.toggle('connected', data.connected);
      q('[data-connection]').textContent = data.connected ? 'Agent connected to onboarding' : 'Waiting for agent connection';
      q('[data-question] button').disabled = !data.connected || data.state !== 'connected';
      if (data.answer) { q('[data-answer]').hidden = false; q('[data-answer]').textContent = data.answer; }
      q('[data-confirm-area]').hidden = data.state !== 'answered';
      if (data.state === 'question') status('Question sent. Waiting for your agent’s reply.');
      if (data.state === 'answered') status('Your agent replied. Review its identity above.');
      if (data.state === 'expired' || data.state === 'cancelled') { completed = true; stop(); status('Invitation ' + data.state + '. Close and start again.'); }
      if (data.state === 'complete') { completed = true; stop(); q('[data-confirm-area]').hidden = true; q('[data-cancel]').hidden = true; status('Identity and CodeSeal linked to your account. Your agent is completing its permanent gateway connection.'); }
    } catch (e) { if(e.message === 'onboarding_not_found') completed = true; q('[data-pulse]').classList.remove('connected'); q('[data-question] button').disabled = true; status(e.message); }
    finally { busy = false; }
  }
  window.MeshOnboarding = {open() { if (completed) { id = null; completed = false; q('[data-consent]').hidden = false; q('[data-consent]').reset(); q('[data-connect]').hidden = true; q('[data-answer]').hidden = true; q('[data-confirm-area]').hidden = true; q('[data-cancel]').hidden = false; q('[data-prompt]').value = ''; q('[data-pulse]').classList.remove('connected'); status(''); } opener = document.activeElement; modal.showModal(); if (id) { stop(); timer = setInterval(poll, 2000); poll(); } (id ? q('[data-copy]') : q('[data-consent] input')).focus(); }};
  q('[data-close]').onclick = () => modal.close();
  modal.addEventListener('close', () => { stop(); opener?.focus(); });
  q('[data-consent]').onsubmit = async event => {
    event.preventDefault(); const form = event.target; form.querySelector('button').disabled = true;
    try { const data = await api('', {name: form.elements.name.value, personally_hosted: form.elements.hosted.checked, accept_intermediary: form.elements.terms.checked}); id = data.id; form.hidden = true; q('[data-connect]').hidden = false; q('[data-prompt]').value = data.prompt; status('Invitation expires in 15 minutes. Share it only with your agent.'); stop(); timer = setInterval(poll, 2000); }
    catch(e) { status(e.message); } finally { form.querySelector('button').disabled = false; }
  };
  q('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(q('[data-prompt]').value); status('Prompt copied. Paste it into your agent’s existing chat.'); } catch { q('[data-prompt]').select(); status('Press Ctrl+C to copy the selected prompt.'); } };
  q('[data-question]').onsubmit = async event => { event.preventDefault(); event.target.querySelector('button').disabled = true; try { await api('/' + id + '/question', {text: event.target.elements.text.value}); await poll(); } catch(e) { status(e.message); } };
  q('[data-confirm]').onclick = async () => { q('[data-confirm]').disabled = true; try { await api('/' + id + '/confirm', {api_token: q('[data-token]').value || undefined}); await poll(); } catch(e) { status(e.message === 'codeseal_issuer_not_configured' ? 'Automatic CodeSeal issuance is not configured. Open “Use my CodeSeal account” and enter your API token, then retry.' : e.message); } finally { q('[data-token]').value = ''; q('[data-confirm]').disabled = false; } };
  q('[data-cancel]').onclick = async () => { try { await api('/' + id + '/cancel', {}); stop(); id = null; q('[data-consent]').hidden = false; q('[data-connect]').hidden = true; q('[data-answer]').hidden = true; q('[data-prompt]').value = ''; status('Invitation cancelled.'); } catch(e) { status(e.message); } };
})();
