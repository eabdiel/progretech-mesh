"""Host-owned progress jobs and shared agent availability through Factory controls."""
import copy
import json
import secrets
import subprocess
import threading
import time
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen


_CONTROL_CACHE = {}
_CONTROL_LOCK = threading.Lock()
ROLE_NAMES = {'main':'rend','researcher':'lyra','coder':'mak','architect':'architect','reviewer':'reviewer','fast':'fast','progre':'progre','designer':'designer'}


def role_controls(home, refresh=False):
    key=str(home)
    with _CONTROL_LOCK:
        saved=_CONTROL_CACHE.get(key)
        if saved and not refresh and time.monotonic()-saved[0]<1:return copy.deepcopy(saved[1])
        command=Path(home)/'Rend/bin/factory-workday'
        if not command.is_file():raise ValueError('runtime_controls_unavailable')
        result=subprocess.run([str(command),'status'],capture_output=True,text=True,timeout=10)
        if result.returncode:raise ValueError('runtime_controls_unavailable')
        data=json.loads(result.stdout)
        rows={row['role']:{k:row.get(k) for k in ('mode','until')} for row in data['controls'] if row.get('role') in ROLE_NAMES.values()}
        _CONTROL_CACHE[key]=(time.monotonic(),rows)
        return copy.deepcopy(rows)


def is_sleeping(row):
    return row['mode'] != 'running' and not (row['mode']=='sleeping' and row.get('until') is not None and row['until']<=time.time())


def provider_error(exc):
    if isinstance(exc,HTTPError):
        text=exc.read(8192).decode('utf-8',errors='replace').lower()
        if any(word in text for word in ('context overflow','context size','context length','exceed_context','prompt too large')):
            return 'mesh_context_limit'
        if exc.code==400:return 'mesh_provider_rejected'
        return 'mesh_provider_unavailable'
    if isinstance(exc,TimeoutError):return 'mesh_reply_timeout'
    return 'mesh_provider_unavailable'


def read_signals(home):
    try:data=json.loads((Path(home)/'.progretech-mesh/agent-signals.json').read_text())
    except (OSError,ValueError):data={}
    for role in ROLE_NAMES:
        try:data[role]=json.loads((Path(home)/'.progretech-mesh/agent-signals'/f'{role}.json').read_text())
        except (OSError,ValueError):pass
    return data


class MeshRuntime:
    def __init__(self, provider, home, opener=urlopen):
        self.provider, self.home, self.open = provider, home, opener
        self.jobs = {}
        self.lock = threading.RLock()
        self.inference = threading.Lock()

    def settings(self, agent):
        from control_center.management import preferences
        with self.provider.lock:
            self.provider._path(agent)
            return preferences(self.provider, agent)

    def config(self, agent):
        cfg = json.loads((self.home / '.openclaw/openclaw.json').read_text())
        role = self.provider.bindings[agent]
        chosen = self.settings(agent).get('model', 'default')
        model = cfg['agents']['entries'][role].get('model', cfg['agents'].get('defaults', {}).get('model', {}))
        chosen = chosen if chosen != 'default' else model if isinstance(model, str) else model.get('primary', '')
        return cfg, role, chosen

    def api(self, path, body=None, timeout=5):
        # Only the established local Ollama endpoint; no cloud-supplied URL.
        request = Request('http://127.0.0.1:11434/api/' + path,
                          data=None if body is None else json.dumps(body).encode(),
                          headers={'Content-Type':'application/json'})
        with self.open(request, timeout=timeout) as response:
            return json.loads(response.read(1048576))

    def model(self, agent):
        cfg, _, chosen = self.config(agent)
        provider = cfg.get('models', {}).get('providers', {}).get('ollama', {})
        if not chosen.startswith('ollama/') or provider.get('baseUrl', '').rstrip('/') != 'http://127.0.0.1:11434':
            raise ValueError('local_preload_unavailable')
        return chosen.split('/',1)[1]

    def status(self, agent):
        try:asleep = self.sleeping(agent)
        except (ValueError,KeyError,OSError,subprocess.SubprocessError):
            return {'scope':'agent','sleeping':None,'model':'','resident':None,'preload_available':False,'controls_available':False}
        try:
            model = self.model(agent)
            names = {m['name'] for m in self.api('ps').get('models',[])}
            resident = model in names
            return {'scope':'agent', 'sleeping':asleep, 'model':model, 'resident':resident, 'preload_available':True,'controls_available':True,'last_result':read_signals(self.home).get(self.provider.bindings[agent],{})}
        except (ValueError, KeyError, OSError, URLError):
            return {'scope':'agent', 'sleeping':asleep, 'model':'', 'resident':None, 'preload_available':False,'controls_available':True,'last_result':read_signals(self.home).get(self.provider.bindings[agent],{})}

    def signal(self, agent, severity, code):
        with self.lock:
            role=self.provider.bindings[agent]
            if role not in ROLE_NAMES:return
            data={'severity':severity,'code':code,'at':time.time()}
            directory=self.home/'.progretech-mesh/agent-signals';directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            path=directory/(role+'.json')
            temporary=path.with_name(path.name+'.'+secrets.token_hex(8)+'.tmp')
            import os
            try:
                fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'w') as stream:
                    json.dump(data,stream);stream.flush();os.fsync(stream.fileno())
                temporary.replace(path)
            finally:
                if temporary.exists():temporary.unlink()

    def new_conversation(self, agent):
        with self.lock:
            if any(self.provider.bindings.get(v['agent_id'])==self.provider.bindings[agent] and not v['done'] for v in self.jobs.values()):raise ValueError('mesh_agent_busy')
            from control_center.management import save_preferences
            save_preferences(self.provider,agent,{'conversation_nonce':secrets.token_hex(12)})
        return {'started':True,'history_preserved':True}

    def sleeping(self, agent):
        role=ROLE_NAMES.get(self.provider.bindings[agent])
        rows=role_controls(self.home)
        if role not in rows:raise ValueError('runtime_controls_unavailable')
        return is_sleeping(rows[role])

    def control(self, agent, awake):
        role=ROLE_NAMES.get(self.provider.bindings[agent])
        if not role:raise ValueError('runtime_controls_unavailable')
        result=subprocess.run([str(self.home/'Rend/bin/factory-workday'),'resume' if awake else 'pause','--agent',role],capture_output=True,text=True,timeout=90)
        if result.returncode:raise ValueError('runtime_control_failed')
        rows=role_controls(self.home,refresh=True)
        if role not in rows or is_sleeping(rows[role])==awake:raise ValueError('runtime_control_not_confirmed')

    def idle(self):
        # Read only counts, never session transcripts or prompts.
        result = subprocess.run(['openclaw','gateway','call','status','--json'], capture_output=True, text=True, timeout=10)
        if result.returncode: raise ValueError('runtime_activity_unavailable')
        data = json.loads(result.stdout)
        work = data.get('shutdownBudget',{}).get('activeWork')
        if not isinstance(work,dict) or not isinstance(data.get('tasks',{}).get('active'),int):
            raise ValueError('runtime_activity_unavailable')
        if any(type(v) is not int or v < 0 for v in work.values()):
            raise ValueError('runtime_activity_unavailable')
        return not sum(work.values()) and data['tasks']['active'] == 0

    def mark(self, ident, phase, detail):
        with self.lock:
            job = self.jobs[ident]
            job.update(phase=phase, detail=detail, updated_at=time.time())
            if not job['milestones'] or job['milestones'][-1]['phase'] != phase:
                job['milestones'].append({'phase':phase,'detail':detail,'at':job['updated_at']})
                job['milestones'] = job['milestones'][-16:]

    def get(self, agent, ident):
        with self.lock:
            job=self.jobs.get(ident)
            if not job or job['agent_id'] != agent: raise ValueError('mesh_job_not_found')
            return copy.deepcopy(job)

    def start(self, agent, kind, worker):
        if kind=='chat' and self.sleeping(agent):raise ValueError('mesh_agent_sleeping')
        with self.lock:
            now=time.time()
            self.jobs={k:v for k,v in self.jobs.items() if not v['done'] or now-v['updated_at']<1800}
            if any(self.provider.bindings.get(v['agent_id'])==self.provider.bindings[agent] and not v['done'] and (kind!='sleep' or v['kind']=='sleep') for v in self.jobs.values()):
                raise ValueError('mesh_agent_busy')
            if len(self.jobs)>=128: raise ValueError('mesh_jobs_full')
            ident=secrets.token_hex(16)
            self.jobs[ident]={'job_id':ident,'agent_id':agent,'kind':kind,'done':False,'phase':'queued',
                'detail':'Request accepted by your host','created_at':now,'updated_at':now,'milestones':[]}
        def run():
            try:
                self.mark(ident,'queued','Waiting for the shared model slot')
                deadline=time.monotonic()+600
                while kind!='sleep' and not self.inference.acquire(timeout=1):
                    if time.monotonic()>deadline:raise ValueError('mesh_queue_timeout')
                try:
                    while kind != 'sleep' and not self.idle():
                        self.mark(ident,'queued','Waiting for other runtime work to finish')
                        if time.monotonic()>deadline:raise ValueError('mesh_queue_timeout')
                        time.sleep(2)
                    result=worker(ident)
                finally:
                    if kind!='sleep':self.inference.release()
                self.mark(ident,'complete','Reply ready' if kind=='chat' else 'Agent availability updated')
                if kind=='chat':
                    try:self.signal(agent,'success','reply_received')
                    except OSError:pass
                with self.lock:self.jobs[ident].update(done=True,result=result)
            except Exception as exc:
                # Do not return credential-bearing transport diagnostics.
                error=str(exc) if isinstance(exc,ValueError) and str(exc).startswith(('mesh_','local_','runtime_','model_')) else provider_error(exc) if isinstance(exc,(HTTPError,URLError,TimeoutError)) else 'mesh_runtime_request_failed'
                self.mark(ident,'failed',error)
                if kind=='chat':
                    try:self.signal(agent,'error',error)
                    except OSError:pass
                with self.lock:self.jobs[ident].update(done=True,error=error)
        threading.Thread(target=run,daemon=True,name='mesh-'+kind).start()
        return self.get(agent,ident)

    def prepare(self, agent, ident):
        model=self.model(agent)
        resident={m['name'] for m in self.api('ps').get('models',[])}
        if model not in resident:
            tags=self.api('tags').get('models',[])
            installed=next((m for m in tags if m.get('name')==model),None)
            if not installed:raise ValueError('model_not_installed')
            memory={}
            for line in Path('/proc/meminfo').read_text().splitlines():
                if line.startswith('MemAvailable:'):memory['available']=int(line.split()[1])*1024
            # Reserve context/runtime/desktop headroom; never evict another model.
            if memory.get('available',0) < int(installed['size']*1.3)+8*1024**3:
                raise ValueError('model_memory_headroom_required')
        self.mark(ident,'warming','Waking up: loading the local model' if model not in resident else 'Refreshing the local model preload')
        self.api('generate',{'model':model,'stream':False,'keep_alive':'15m'},timeout=300)
        if model not in {m['name'] for m in self.api('ps').get('models',[])}:
            raise ValueError('model_preload_not_confirmed')
        self.mark(ident,'ready','Local model is loaded')
        return model

    def power(self, agent, awake):
        def worker(ident):
            if awake:
                try:self.prepare(agent,ident)
                except ValueError as exc:
                    if str(exc)!='local_preload_unavailable':raise
                self.control(agent,True)
                return self.status(agent)
            self.mark(ident,'sleeping','Putting this agent to sleep in Mesh and Factory')
            self.control(agent,False)
            try:model=self.model(agent)
            except ValueError:
                return {**self.status(agent),'note':'Agent asleep; model preload is unavailable on this provider'}
            shared=False
            for other in list(self.provider.bindings):
                if other==agent:continue
                try:
                    if self.sleeping(other):continue
                except ValueError:
                    shared=True;continue
                try:shared=shared or self.model(other)==model
                except ValueError:pass
            # Model release never interrupts another agent or a shared model user.
            if not shared and self.inference.acquire(blocking=False):
                try:
                    if self.idle():self.api('generate',{'model':model,'stream':False,'keep_alive':0},timeout=30)
                finally:self.inference.release()
            status=self.status(agent)
            status['note']='Model retained for other roles or channels' if status.get('resident') else 'Local model released'
            return status
        return self.start(agent,'wake' if awake else 'sleep',worker)

    def chat(self, agent, text):
        def worker(ident):
            cfg,role,chosen=self.config(agent)
            if not self.settings(agent).get('enabled',True):raise ValueError('mesh_enrollment_removed')
            if self.sleeping(agent):raise ValueError('mesh_agent_sleeping')
            if chosen.startswith('ollama/'):self.prepare(agent,ident)
            port=cfg['gateway'].get('port',18789)
            if type(port) is not int or not 1<=port<=65535:raise ValueError('runtime_port_invalid')
            headers={'Content-Type':'application/json','Authorization':'Bearer '+cfg['gateway']['auth']['token'],
                'x-openclaw-agent-id':role,'x-openclaw-message-channel':'mesh',
                'x-openclaw-session-key':'agent:'+role+':mesh-chat:'+agent}
            nonce=self.settings(agent).get('conversation_nonce')
            if nonce:headers['x-openclaw-session-key']+=':'+nonce
            if self.settings(agent).get('model','default')!='default':headers['x-openclaw-model']=chosen
            req=Request(f'http://127.0.0.1:{port}/v1/chat/completions',data=json.dumps({'model':'openclaw/'+role,'stream':True,
                'messages':[{'role':'user','content':text}],'user':'mesh-conversation-'+agent}).encode(),headers=headers)
            self.mark(ident,'processing','Processing your request; waiting for reply text')
            reply=[];length=0;deadline=time.monotonic()+300;finished=False
            with self.open(req,timeout=300) as response:
                for raw in response:
                    if time.monotonic()>deadline:raise ValueError('mesh_reply_timeout')
                    if len(raw)>1048576:raise ValueError('mesh_reply_too_large')
                    if not raw.startswith(b'data:'):continue
                    value=raw[5:].strip()
                    if value==b'[DONE]':finished=True;break
                    chunk=json.loads(value)
                    if chunk.get('error'):raise ValueError('mesh_reply_failed')
                    for choice in chunk.get('choices',[]):
                        content=choice.get('delta',{}).get('content')
                        if isinstance(content,str) and content:
                            self.mark(ident,'writing','Writing the reply')
                            reply.append(content);length+=len(content)
                            if length>1048576:raise ValueError('mesh_reply_too_large')
                        if choice.get('finish_reason'):finished=True
            if not finished or not reply:raise ValueError('mesh_reply_incomplete')
            answer=''.join(reply)
            if answer.lstrip().startswith(('⚠️ LLM request failed','LLM request failed:')):raise ValueError('mesh_provider_rejected')
            return {'reply':answer,'role':role,'model':chosen}
        return self.start(agent,'chat',worker)

    def snapshot(self, agent, kind):
        state=self.status(agent)
        with self.lock:
            jobs=[self.get(agent,k) for k,v in self.jobs.items() if v['agent_id']==agent][-8:]
        lines=[f'Agent availability: {"unknown" if state["sleeping"] is None else "asleep" if state["sleeping"] else "awake"}',
               f'Local model: {state["model"] or "unavailable"}',f'Model resident: {state["resident"]}']
        if kind=='task':
            try:
                data=json.loads((self.home/'.local/state/progretech-workday/activity.json').read_text())
                role=ROLE_NAMES.get(self.provider.bindings[agent])
                row=data.get('agents',{}).get(role,{})
                if row.get('task_id'):lines.append('Factory task: '+str(row['task_id']))
                lines += [f'Factory · {t["phase"]}: {t["state"]}' for t in data.get('tasks',[]) if t.get('role')==role and t.get('state') in {'running','queued','uncertain'}][-8:]
            except (OSError,ValueError,KeyError):pass
            lines += [f'{j["kind"]}: {j["detail"]}' for j in jobs if not j['done']]
            if not any(not j['done'] for j in jobs):lines.append('No active Mesh request for this role')
        else:
            lines += [f'{j["kind"]} · {m["detail"]}' for j in jobs for m in j['milestones']][-16:]
            lines.append('Scoped Mesh runtime snapshot; no arbitrary shell or other-role conversation data')
        return {'kind':kind,'agent_id':agent,'scope':'agent','lines':lines,'runtime':state}
