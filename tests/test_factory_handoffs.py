import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from control_center.handoffs import Handoffs

class FakeMesh:
    def __init__(self):self.calls=[];self.jobs={};self.asleep=False;self.native_idle=True;self.inference=threading.Lock();self.lock=threading.RLock()
    def status(self,a):return {'sleeping':self.asleep}
    def sleeping(self,a):return self.asleep
    def idle(self):return self.native_idle
    def chat(self,a,text,**kwargs):
        j={'job_id':str(len(self.calls)),'done':False,'agent_id':a};self.calls.append((a,text));self.jobs[(a,j['job_id'])]=j;return j
    def get(self,a,i):return self.jobs[(a,i)]

class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name)
        self.mesh=FakeMesh();self.provider=SimpleNamespace(bindings={'host':'main','host--designer':'designer','host--reviewer':'reviewer'})
        self.addCleanup(patch.stopall)
        patch('control_center.chatter_admission.resources',return_value=(True,'Capacity confirmed')).start()
        patch('control_center.office.engine',return_value={'snapshot':{'paused':False}}).start()
        self.h=Handoffs(self.provider,self.home,self.mesh);self.notices=[];self.h.notify=lambda t:self.notices.append(t) or True
    def publish(self):
        p=self.home/'Rend/artifacts/designer/icon.svg';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('<svg/>');return p
    def create(self):return self.h.dispatch('host--reviewer','handoff.create',{'source':'designer','text':'Review the generated icon.'})
    def test_dependency_waits_for_new_artifact_then_runs_once_and_notifies_director(self):
        self.publish();self.h.tick();r=self.create();self.h.tick();self.assertEqual(self.mesh.calls,[])
        time.sleep(.01);p=self.publish();self.h.tick();self.assertEqual(len(self.mesh.calls),1);self.assertEqual(self.mesh.calls[0][0],'host--reviewer');self.assertIn(str(p),self.mesh.calls[0][1])
        self.h.tick();self.assertEqual(len(self.mesh.calls),1)
        self.mesh.jobs[('host--reviewer','0')].update(done=True,result={'reply':'Reviewed icon; contrast needs work.'})
        self.h.tick();row=self.h.data['rules'][0];self.assertEqual(row['state'],'delivered');self.assertTrue(row['director_notified']);self.assertTrue(any('contrast' in t for t in self.notices))
    def test_owner_pause_cancel_and_target_bound_controls(self):
        r=self.create();self.h.dispatch('host--reviewer','handoff.control',{'id':r['id'],'state':'paused'});self.publish();self.h.tick();self.assertEqual(self.mesh.calls,[])
        with self.assertRaises(ValueError):self.h.dispatch('host--designer','handoff.control',{'id':r['id'],'state':'waiting'})
        self.h.dispatch('host--reviewer','handoff.control',{'id':r['id'],'state':'cancelled'});self.h.tick();self.assertEqual(self.mesh.calls,[])
    def test_sleep_and_restart_do_not_replay_started_work(self):
        self.create();self.publish();self.mesh.asleep=True;self.h.tick();self.assertFalse(self.mesh.calls)
        self.mesh.asleep=False;self.h.tick();self.assertEqual(len(self.mesh.calls),1)
        h=Handoffs(self.provider,self.home,self.mesh);self.assertEqual(h.data['rules'][0]['state'],'unconfirmed');h.notify=lambda _:True;h.tick();self.assertEqual(len(self.mesh.calls),1)
    def test_chatter_opt_in_idle_pair_and_two_actual_replies(self):
        self.h.chatter_tick();self.assertFalse(self.mesh.calls)
        self.h.dispatch('host','chatter.configure',{'enabled':True});self.mesh.native_idle=False;self.h.chatter_tick();self.assertFalse(self.mesh.calls)
        self.mesh.native_idle=True
        with patch('control_center.office.engine',return_value={'snapshot':{'paused':False}}):self.h.chatter_tick()
        chat=self.h.data['chatter']['conversations'][0];self.assertEqual(chat['state'],'approaching');self.assertFalse(self.mesh.calls);chat['approach_until']=0;self.h.chatter_tick();self.assertEqual(len(self.mesh.calls),1)
        self.mesh.jobs[(chat['a'],'0')].update(done=True,result={'reply':'Use evidence-linked review.'})
        self.h.chatter_tick();self.assertEqual(len(self.mesh.calls),2)
        self.mesh.jobs[(chat['b'],'1')].update(done=True,result={'reply':'Agreed; verify recall before claiming learning.'})
        self.h.chatter_tick();self.assertEqual(chat['state'],'complete');self.assertEqual(len(chat['messages']),2)
        self.h.chatter_tick();self.assertEqual(len(self.mesh.calls),2)
    def test_disabling_chatter_stops_before_second_turn(self):
        self.h.dispatch('host','chatter.configure',{'enabled':True})
        with patch('control_center.office.engine',return_value={'snapshot':{'paused':False}}):self.h.chatter_tick()
        chat=self.h.data['chatter']['conversations'][0];chat['approach_until']=0;self.h.chatter_tick();self.h.dispatch('host','chatter.configure',{'enabled':False});self.mesh.jobs[(chat['a'],'0')].update(done=True,result={'reply':'Suggestion'})
        self.h.chatter_tick();self.assertEqual(chat['state'],'stopped');self.assertEqual(len(self.mesh.calls),1)
    def test_serial_conversations_repeat_inside_and_after_windows(self):
        self.h.dispatch('host','chatter.configure',{'enabled':True})
        self.h.chatter_tick();c=self.h.data['chatter']['conversations'][0];c['approach_until']=0
        self.h.chatter_tick();self.h.chatter_tick();self.assertEqual(len(self.mesh.calls),1)
        self.mesh.jobs[(c['a'],'0')].update(done=True,result={'reply':'First'})
        self.h.chatter_tick();self.assertEqual(len(self.mesh.calls),2)
        self.mesh.jobs[(c['b'],'1')].update(done=True,result={'reply':'Second'})
        self.h.chatter_tick();ch=self.h.data['chatter'];ch['next_at']=0
        self.h.chatter_tick();self.assertEqual(len(ch['conversations']),2)
        old=ch['window_ends'];ch['window_ends']=0;self.h.chatter_tick();self.assertGreater(ch['window_ends'],old-1)
    def test_pair_topic_and_resource_wait_preserve_request(self):
        self.h.dispatch('host','chatter.configure',{'enabled':True})
        c=self.h.dispatch('host','chatter.pair',{'a':'host--designer','b':'host--reviewer','topic':''})
        self.h.dispatch('host','chatter.topic',{'id':c['id'],'topic':'Icon accessibility'})
        self.h.chatter_tick();c=self.h.data['chatter']['conversations'][0];c['approach_until']=0
        with patch('control_center.chatter_admission.resources',return_value=(False,'Waiting for RAM headroom')):self.h.chatter_tick()
        self.assertFalse(self.mesh.calls);self.assertEqual(c['state'],'approaching');self.assertIn('RAM',c['note'])
        self.h.chatter_tick();self.assertIn('Icon accessibility',self.mesh.calls[0][1])
        with self.assertRaisesRegex(ValueError,'invalid_chatter_pair'):self.h.dispatch('host','chatter.pair',{'a':'other--designer','b':'host--reviewer','topic':''})
    def test_owner_requests_preempt_chatter(self):
        self.h.dispatch('host','chatter.configure',{'enabled':True})
        self.mesh.jobs['owner']={'agent_id':'host','done':False}
        self.h.chatter_tick();self.assertFalse(self.h.data['chatter']['conversations']);self.assertIn('priority',self.h.data['chatter']['admission'])

    def test_mission_priority_persists_and_rejects_running_mutation(self):
        patch.stopall()
        from control_center.office import engine,validate_office
        body={'operation':'task.priority','args':{'id':'task-'+'a'*12,'priority':99}};validate_office(body)
        created=engine(self.home,'main','task.create',{'title':'Review','description':'Owner task','assignee':'orchestrator','dependsOn':[],'needsApproval':False})
        tid=created['result']['id'];result=engine(self.home,'main','task.priority',{'id':tid,'priority':20});self.assertEqual(result['snapshot']['tasks'][0]['priority'],20)
        engine(self.home,'main','begin',{'id':tid})
        with self.assertRaisesRegex(ValueError,'task_not_ready'):engine(self.home,'main','task.priority',{'id':tid,'priority':21})
