"""Durable owner-authorized artifact dependencies; no inferred chat permissions."""
import copy
import json
import secrets
import random
import subprocess
import threading
import time
from pathlib import Path
from control_center.artifacts import catalog, public, write, ROLES


def validate(action,args):
    fields={'handoff.create':{'source','text'},'handoff.list':set(),'handoff.control':{'id','state'},'chatter.configure':{'enabled'},'chatter.history':set()}[action]
    if action=='chatter.configure':
        if not isinstance(args,dict) or set(args)!=fields or type(args['enabled']) is not bool:raise ValueError('invalid_chatter_settings')
        return
    if not isinstance(args,dict) or set(args)!=fields or any(not isinstance(v,str) or '\x00' in v for v in args.values()):raise ValueError('invalid_handoff_args')
    if action=='handoff.create' and (args['source'] not in ROLES.values() or not args['text'].strip() or len(args['text'])>3000):raise ValueError('invalid_handoff_instruction')
    if action=='handoff.control' and (len(args['id'])!=32 or args['state'] not in {'paused','waiting','cancelled'}):raise ValueError('invalid_handoff_control')


class Handoffs:
    def __init__(self,provider,home,mesh):
        self.provider,self.home,self.mesh=provider,Path(home),mesh
        self.path=self.home/'.progretech-mesh/artifact-handoffs.json'
        self.lock=threading.RLock()
        self.started=False
        try:self.data=json.loads(self.path.read_text())
        except (OSError,ValueError):self.data={'rules':[],'seen':[],'notifications':[]}
        self.data.setdefault('chatter',{'enabled':False,'next_at':0,'conversations':[]})
        for chat in self.data['chatter']['conversations']:
            if chat['state'] in {'approaching','dispatching','first','second'}:chat.update(state='unconfirmed',note='Host restarted; conversation was not replayed.')
        for row in self.data['rules']:
            if row['state'] in {'dispatching','running'}:row.update(state='unconfirmed',note='Host restarted during execution. Review status before creating a replacement; no automatic replay.')
        self.save()
    def save(self):
        self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);write(self.path,self.data)
    def dispatch(self,agent,action,args):
        validate(action,args)
        with self.lock:
            if action=='chatter.configure':
                self.data['chatter']['enabled']=args['enabled'];self.save();return copy.deepcopy(self.data['chatter'])
            if action=='chatter.history':return copy.deepcopy(self.data['chatter'])
            if action=='handoff.list':
                result=copy.deepcopy(self.data)
                for r in result['rules']:r.pop('baseline',None)
                for c in result['chatter']['conversations']:c.pop('prompt',None)
                return result
            if action=='handoff.create':
                if len(self.data['rules'])>=100:raise ValueError('handoff_queue_full')
                target=self.provider.bindings[agent]
                if target not in ROLES or ROLES[target]==args['source']:raise ValueError('invalid_handoff_target')
                row={'id':secrets.token_hex(16),'target':agent,'target_role':ROLES[target],'source':args['source'],'text':args['text'],'created':time.time(),'baseline':[f['id'] for f in catalog(self.home) if f['producer']==args['source']],'state':'waiting','note':'Waiting for a new published artifact from '+args['source']}
                self.data['rules'].append(row);self.save();return copy.deepcopy(row)
            row=next((r for r in self.data['rules'] if r['id']==args['id']),None)
            if not row or row['target']!=agent:raise ValueError('handoff_not_found')
            if row['state'] not in {'waiting','paused'}:raise ValueError('handoff_already_started')
            row.update(state=args['state']);self.save();return copy.deepcopy(row)
    def notify(self,text):
        # The shared office belongs to the exact enrolled parent gateway binding.
        from control_center.office import engine, namespace
        parents=[a for a,r in self.provider.bindings.items() if r=='main' and '--' not in a]
        if not parents:return False
        engine(self.home,namespace('main',parents[0]),'message',{'to':'orchestrator','text':text[:4000]})
        return True
    def tick(self):
        with self.lock:
            files=catalog(self.home)
            # Existing files on first activation are catalogued, not claimed as new delivery.
            if not self.data.get('initialized'):
                self.data['seen']=[f['id'] for f in files];self.data['initialized']=True;self.save()
            for f in files:
                if f['id'] in self.data['seen']:continue
                text='Artifact published by '+f['producer']+': '+f['name']+' ('+f['source']+'). Review/download in Factory Artifacts. Publication is not a claim of task completion.'
                if not self.notify(text):continue
                self.data['seen'].append(f['id']);self.data['seen']=self.data['seen'][-1000:]
                self.data['notifications'].append({'at':time.time(),'kind':'artifact','file':public(f),'note':text});self.data['notifications']=self.data['notifications'][-100:];self.save()
            for row in self.data['rules']:
                if row['state']=='running':
                    try:job=self.mesh.get(row['target'],row['job_id'])
                    except ValueError:row.update(state='unconfirmed',note='Runtime receipt unavailable; no automatic replay.');self.save();continue
                    if not job.get('done'):continue
                    error=job.get('error');row.update(state='failed' if error else 'delivered',note=error or job.get('result',{}).get('reply','Reply completed')[:6000],finished=time.time())
                    row['director_notified']=self.notify('Conditional instruction '+row['state']+' by '+row['target_role']+' after '+row['source']+' published '+row['artifact']['name']+'.\n'+row['note'][:3000]);self.save()
                if row['state'] in {'delivered','failed'} and not row.get('director_notified'):
                    row['director_notified']=self.notify('Conditional instruction '+row['state']+' by '+row['target_role']+'.\n'+row.get('note','')[:3000]);self.save()
                if row['state']!='waiting' or row['target'] not in self.provider.bindings:continue
                try:
                    # Snapshot actual availability; MeshRuntime also serializes inference and native work.
                    if self.mesh.sleeping(row['target']):continue
                except (ValueError,KeyError,OSError):continue
                match=next((f for f in files if f['producer']==row['source'] and f['id'] not in row.get('baseline',[]) and f['downloadable']),None)
                if not match:continue
                row.update(state='dispatching',artifact=public(match));self.save()
                text=row['text']+'\nDependency delivered by '+row['source']+': '+match['path']+'\nRead this published artifact before answering. Report what you actually reviewed. If producing files, save them under '+str(self.home/'Rend/artifacts'/row['target_role'])+'.'
                try:
                    job=self.mesh.chat(row['target'],text);row.update(state='running',job_id=job['job_id'],note='Dependency received; follow-up admitted to the runtime queue.')
                except ValueError as e:
                    if str(e) in {'mesh_agent_busy','mesh_agent_sleeping'}:row.update(state='waiting',note='Waiting for target availability.')
                    else:row.update(state='failed',note=str(e))
                self.save()
    def chatter_tick(self):
        with self.lock:
            chatter=self.data['chatter']
            active=next((c for c in chatter['conversations'] if c['state'] in {'approaching','first','second'}),None)
            if active and active['state']=='approaching':
                if not chatter['enabled']:active.update(state='stopped',note='Chatter disabled before dispatch.');self.save();return
                if time.time()<active['approach_until']:return
                if not self.mesh.idle() or self.mesh.inference.locked() or self.mesh.sleeping(active['a']) or self.mesh.sleeping(active['b']):active.update(state='stopped',note='Other work or sleep took precedence before the conversation.');self.save();return
                active.update(state='dispatching');self.save()
                try:j=self.mesh.chat(active['a'],active.pop('prompt'));active.update(state='first',job_id=j['job_id'])
                except ValueError as e:active.update(state='failed',note=str(e))
                self.save();return
            if active:
                try:job=self.mesh.get(active['a'] if active['state']=='first' else active['b'],active['job_id'])
                except ValueError:active.update(state='unconfirmed',note='Runtime receipt unavailable; no replay.');self.save();return
                if not job.get('done'):return
                if job.get('error'):active.update(state='failed',note=job['error']);self.save();return
                reply=job.get('result',{}).get('reply','')[:4000]
                active['messages'].append({'agent':active['a_role'] if active['state']=='first' else active['b_role'],'text':reply,'at':time.time()})
                if active['state']=='second':active.update(state='complete',finished=time.time());self.save();return
                if not chatter['enabled']:active.update(state='stopped',note='Chatter disabled after first reply.');self.save();return
                if not self.mesh.idle() or self.mesh.sleeping(active['b']):active.update(state='stopped',note='Other work or sleep took precedence.');self.save();return
                active.update(state='dispatching');self.save()
                try:
                    j=self.mesh.chat(active['b'],'Office chatter, discussion only; do not execute changes or send external messages. '+active['a_role']+' said: '+reply[:2500]+'\nRespond with a useful technical suggestion for ProgreTech. Consult your own identity/project MemPalace context when useful, keep private records private, distinguish evidence from ideas. Save a reviewed activity checkpoint or honestly report limits.');active.update(state='second',job_id=j['job_id'])
                except ValueError as e:active.update(state='failed',note=str(e))
                self.save();return
            if not chatter['enabled'] or time.time()<chatter['next_at']:return
            if not self.mesh.idle() or self.mesh.inference.locked():return
            from control_center.office import engine,namespace
            parents=[a for a,r in self.provider.bindings.items() if r=='main' and '--' not in a]
            if not parents or engine(self.home,namespace('main',parents[0]),'snapshot',{})['snapshot']['paused']:return
            candidates=[]
            for aid,runtime in self.provider.bindings.items():
                if '--' in aid and runtime in ROLES and not self.mesh.sleeping(aid):candidates.append((aid,ROLES[runtime]))
            if len(candidates)<2:return
            a,b=random.sample(candidates,2)
            topics=['charter and safe delegation','artifact quality and review','MemPalace evidence and learning','project usability and maintainability']
            topic=random.choice(topics);context=[]
            for repo in ['progretech-mesh','progretech-site','progretech-atlas','CodeSealWebApp']:
                path=self.home/'PycharmProjects'/repo
                if not path.is_dir() or path.is_symlink():continue
                p=subprocess.run(['git','-C',str(path),'status','--porcelain'],capture_output=True,text=True,timeout=5)
                if p.returncode==0:context.append(repo+': '+str(len(p.stdout.splitlines()))+' changed paths (metadata only)')
            try:
                activity=json.loads((self.home/'.local/state/progretech-workday/activity.json').read_text())
                for runtime,role in [a,b]:
                    observed=activity.get('agents',{}).get(role,{})
                    context.append(role+': '+str(observed.get('state','unknown'))+'; task '+str(observed.get('task_id') or 'unreported'))
            except (OSError,ValueError):context.append('Current activity metadata unavailable')
            row={'id':secrets.token_hex(16),'a':a[0],'b':b[0],'a_role':a[1],'b_role':b[1],'topic':topic,'state':'approaching','approach_until':time.time()+5,'created':time.time(),'messages':[],'context':context}
            chatter['conversations'].append(row);chatter['conversations']=chatter['conversations'][-50:];chatter['next_at']=time.time()+900;self.save()
            prompt='Office chatter with '+b[1]+' about '+topic+'. Discussion only: do not execute changes or send external messages. Offer one useful ProgreTech suggestion grounded in observed work. Shared repo metadata: '+('; '.join(context) or 'unavailable')+'. Consult your own identity/project MemPalace teaching context and charter when useful; do not quote private records. Distinguish suggestions from verified lessons. Save a reviewed activity checkpoint or honestly report limits.'
            row['prompt']=prompt
            self.save()

    def start(self):
        with self.lock:
            if self.started:return
            self.started=True
        def run():
            while True:
                try:
                    self.tick()
                    self.chatter_tick()
                except Exception:
                    with self.lock:
                        self.data['scheduler_status']='Host scheduler check failed; queued instructions remain retained. No automatic replay.'
                        self.save()
                time.sleep(5)
        threading.Thread(target=run,daemon=True,name='mesh-artifact-handoffs').start()
