import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from unittest.mock import patch
from control_center.provider import AgentControlProvider
from control_center.mesh_runtime import MeshRuntime, provider_error
from control_center.management import validate_management
from control_center.office import engine, validate_office
from control_center.office_relations import interactions


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name)
        (self.home/'.openclaw').mkdir();(self.home/'.progretech-mesh').mkdir()
        (self.home/'.openclaw/openclaw.json').write_text(json.dumps({'agents':{'entries':{'main':{'model':'remote/model'},'architect':{'model':'remote/model'}}},'gateway':{'port':18789,'auth':{'token':'fixture'}}}))
        self.provider=AgentControlProvider(self.home/'profiles',{'host':'main','host--main':'main','host--architect':'architect'},lambda r:{},lambda *a:{})
        self.runtime=MeshRuntime(self.provider,self.home)
        self.runtime.idle=lambda:True
        self.rows={'rend':{'mode':'running','until':None},'architect':{'mode':'running','until':None}}
        self.controls=patch('control_center.mesh_runtime.role_controls',side_effect=lambda *a,**k:self.rows);self.controls.start();self.addCleanup(self.controls.stop)
    def done(self,agent,job):
        deadline=time.monotonic()+2
        while time.monotonic()<deadline:
            value=self.runtime.get(agent,job['job_id'])
            if value['done']:return value
            time.sleep(.01)
        self.fail('Job did not finish')
    def test_chatter_guard_precedes_loading_and_does_not_mark_error(self):
        self.runtime.prepare=lambda *a:self.fail('Deferred chatter must not load models')
        self.runtime.signal('host','success','reply_received')
        def guard(ident):
            self.assertTrue(self.runtime.inference.locked())
            raise ValueError('mesh_chatter_deferred')
        job=self.done('host',self.runtime.chat('host','Discussion only',admission=guard,background='a'*32))
        self.assertEqual(job['error'],'mesh_chatter_deferred')
        self.assertEqual(self.runtime.status('host')['last_result']['severity'],'success')

    def test_progress_is_agent_scoped_and_busy_aliases_rejected(self):
        hold=threading.Event();self.addCleanup(hold.set)
        def worker(j):self.runtime.mark(j,'processing','Waiting for reply text');hold.wait(2);return {'reply':'private fixture'}
        job=self.runtime.start('host','chat',worker)
        with self.assertRaisesRegex(ValueError,'not_found'):self.runtime.get('host--architect',job['job_id'])
        with self.assertRaisesRegex(ValueError,'busy'):self.runtime.start('host--main','chat',worker)
        with self.assertRaisesRegex(ValueError,'busy'):self.runtime.new_conversation('host--main')
        self.assertNotIn('private fixture',str(self.runtime.snapshot('host','terminal')))
        hold.set();self.assertTrue(self.done('host',job)['done'])
    def test_sleep_can_interrupt_own_active_request_and_cross_view_state(self):
        hold=threading.Event();self.addCleanup(hold.set)
        job=self.runtime.start('host','chat',lambda j:hold.wait(2) or {})
        def control(agent,awake):self.rows['rend']['mode']='running' if awake else 'paused'
        self.runtime.control=control
        self.runtime.model=lambda a:(_ for _ in ()).throw(ValueError('local_preload_unavailable'))
        asleep=self.done('host',self.runtime.power('host',False))
        self.assertTrue(asleep['result']['sleeping']);self.assertTrue(self.runtime.status('host--main')['sleeping'])
        with self.assertRaisesRegex(ValueError,'sleeping'):self.runtime.chat('host--main','hello')
        hold.set();self.done('host',job)
        awake=self.done('host',self.runtime.power('host',True));self.assertFalse(awake['result']['sleeping'])
    def test_wake_resumes_without_interrupting_busy_native_work(self):
        self.rows['rend']['mode']='paused'
        self.runtime.idle=lambda:False
        self.runtime.control=lambda a,awake:self.rows['rend'].update(mode='running' if awake else 'paused')
        self.runtime.prepare=lambda *a:self.fail('Busy native work must not trigger model preload')
        self.runtime.inference.acquire();self.addCleanup(self.runtime.inference.release)
        value=self.done('host',self.runtime.power('host',True))
        self.assertFalse(value['result']['sleeping'])
        self.assertIn('deferred',value['result']['note'])
    def test_active_context_is_bound_to_observed_role_and_not_replayed(self):
        directory=self.home/'.local/state/progretech-workday';directory.mkdir(parents=True)
        file=directory/'activity.json'
        file.write_text(json.dumps({'agents':{'architect':{'state':'active','session':'agent:architect:workday:fixture'}}}))
        with patch('control_center.mesh_runtime.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='{"status":"accepted"}')) as run:
            result=self.runtime.context('host--architect','Owner context')
            params=json.loads(run.call_args.args[0][-2]);self.assertEqual(params['agentId'],'architect');self.assertEqual(params['queueMode'],'steer');self.assertEqual(params['sessionKey'],'agent:architect:workday:fixture');self.assertTrue(result['accepted']);self.assertEqual(run.call_count,1)
        file.write_text(json.dumps({'agents':{'architect':{'state':'active','session':'agent:main:workday:fixture'}}}))
        with patch('control_center.mesh_runtime.subprocess.run') as run:
            with self.assertRaisesRegex(ValueError,'session_unavailable'):self.runtime.context('host--architect','Owner context')
            run.assert_not_called()
        file.write_text(json.dumps({'agents':{'architect':{'state':'idle'}}}))
        with self.assertRaisesRegex(ValueError,'no_active_work'):self.runtime.context('host--architect','Owner context')
    def test_recovery_defers_busy_work_and_never_replays_a_chat(self):
        self.runtime.signal('host','error','mesh_context_limit')
        self.runtime.chat=lambda *a:self.fail('Recovery must not replay a task')
        self.runtime.prepare=lambda *a:self.fail('Busy gateway must not prepare a model')
        status={'shutdownBudget':{'activeWork':{'rootRequests':1}},'tasks':{'active':1}}
        with patch('control_center.mesh_runtime.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(status))):
            result=self.done('host',self.runtime.recover('host'))
        self.assertEqual(result['result']['outcome'],'deferred');self.assertNotIn('conversation_nonce',self.runtime.settings('host'))
        self.assertEqual(self.runtime.status('host')['last_result']['severity'],'error')
    def test_recovery_can_reset_context_without_clearing_error_or_old_history(self):
        self.runtime.signal('host','error','mesh_context_limit')
        self.runtime.model=lambda a:'fixture'
        self.runtime.api=lambda *a,**k:{'models':[{'name':'fixture'}]}
        self.runtime.prepare=lambda *a:'fixture'
        status={'shutdownBudget':{'activeWork':{'rootRequests':0}},'tasks':{'active':0}}
        with patch('control_center.mesh_runtime.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(status))):
            result=self.done('host',self.runtime.recover('host'))
        self.assertEqual(result['result']['outcome'],'checks_passed');self.assertIn('conversation_nonce',self.runtime.settings('host'))
        self.assertEqual(self.runtime.status('host')['last_result']['severity'],'error')
        self.assertNotIn('conversation_nonce',self.runtime.settings('host--architect'))
    def test_shared_model_is_retained_on_sleep(self):
        self.runtime.model=lambda a:'shared'
        self.runtime.control=lambda a,awake:self.rows['rend'].update(mode='paused')
        calls=[]
        self.runtime.api=lambda path,body=None,**kw:calls.append((path,body)) or {'models':[{'name':'shared'}]}
        value=self.done('host',self.runtime.power('host',False))
        self.assertTrue(value['result']['sleeping']);self.assertFalse(any(body and body.get('keep_alive')==0 for _,body in calls))
    def test_final_reply_progress_excludes_reasoning_without_append_only_stream(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def read(self,size):return json.dumps({'choices':[{'message':{'content':'actual answer','reasoning_content':'hidden fixture'},'finish_reason':'stop'}]}).encode()
        requests=[]
        self.runtime.open=lambda req,**k:requests.append(req) or Response()
        value=self.done('host--architect',self.runtime.chat('host--architect','fixture request'))
        self.assertEqual(value['result']['reply'],'actual answer')
        self.assertIn('writing',[m['phase'] for m in value['milestones']])
        self.assertNotIn('hidden fixture',str(value));self.assertEqual(requests[0].get_header('X-openclaw-agent-id'),'architect');self.assertFalse(json.loads(requests[0].data)['stream'])
    def test_failed_job_finishes_even_if_signal_write_fails(self):
        self.runtime.signal=lambda *a:(_ for _ in ()).throw(OSError('fixture'))
        value=self.done('host',self.runtime.start('host','chat',lambda j:(_ for _ in ()).throw(ValueError('mesh_context_limit'))))
        self.assertEqual(value['error'],'mesh_context_limit')
    def test_provider_errors_do_not_expose_payloads(self):
        err=HTTPError('http://local',400,'Bad',{},io.BytesIO(b'request exceeds available context size; sensitive payload'))
        self.assertEqual(provider_error(err),'mesh_context_limit');err.close()
    def test_validation_rejects_job_snapshot_and_shell_injection(self):
        for action,args in [('runtime.sleep',{'command':'sh'}),('communication.job',{'job_id':'../a'}),('runtime.snapshot',{'kind':'shell'})]:
            with self.assertRaises(ValueError):validate_management(action,args)


class RelationshipTests(unittest.TestCase):
    def test_only_same_active_task_creates_collaboration(self):
        with tempfile.TemporaryDirectory() as home:
            snap={'agents':[],'tasks':[],'messages':[],'events':[],'factoryAgents':[{'id':'rend','state':'active','task_id':'shared','part':'Function'},{'id':'mak','state':'active','task_id':'shared','part':'UI'},{'id':'lyra','state':'active','task_id':'different'}]}
            links=interactions(snap,home);self.assertEqual(len(links),1);self.assertEqual(links[0]['parts']['factory-mak'],'UI')
            snap['factoryAgents'][1]['state']='idle';self.assertEqual(interactions(snap,home),[])


class MailboxTests(unittest.TestCase):
    def test_owner_can_review_edit_prioritize_remove_pending_and_claim_on_begin(self):
        with tempfile.TemporaryDirectory() as home:
            call=lambda op,args={}:engine(home,'fixture',op,args)
            call('snapshot')
            a=call('message',{'to':'orchestrator','text':'First'})['result']['id']
            b=call('message',{'to':'orchestrator','text':'Second'})['result']['id']
            call('mailbox.edit',{'agent':'orchestrator','id':a,'text':'Edited'})
            call('mailbox.priority',{'agent':'orchestrator','id':b,'priority':10})
            items=call('mailbox.list',{'agent':'orchestrator'})['result']['pending'];self.assertEqual(items[0]['id'],b);self.assertEqual(items[1]['body'],'Edited')
            call('mailbox.remove',{'agent':'orchestrator','id':a})
            task=call('task.create',{'title':'Mission','description':'Brief','assignee':'orchestrator','dependsOn':[],'needsApproval':False})['result']['id']
            context=call('begin',{'id':task})['result'];self.assertIn('Second',context['agents'][0]['messages'])
            queue=call('mailbox.list',{'agent':'orchestrator'})['result'];self.assertEqual(queue['pending'],[]);self.assertTrue(queue['history'])
            next_item=call('message',{'to':'orchestrator','text':'Future mission context'})['result']['id']
            call('mailbox.edit',{'agent':'orchestrator','id':next_item,'text':'Edited future context'})
            self.assertEqual(call('mailbox.list',{'agent':'orchestrator'})['result']['pending'][0]['body'],'Edited future context')
            with self.assertRaisesRegex(ValueError,'not_pending|busy'):call('mailbox.remove',{'agent':'orchestrator','id':b})
    def test_mailbox_cannot_supply_paths_or_commands(self):
        with self.assertRaises(ValueError):validate_office({'operation':'mailbox.edit','args':{'agent':'x','id':'y','text':'z','path':'/etc'}})
