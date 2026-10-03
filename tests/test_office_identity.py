import json
import tempfile
import unittest
from pathlib import Path
from control_center.office import engine
from control_center.office_identity import synchronize, project


class IdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.home=self.tmp.name
    def call(self, op, args=None):return engine(self.home,'scope',op,args)
    def test_handoff_preserves_identity_memory_and_delivered_history(self):
        worker=self.call('hire',{'name':'Ada','role':'Engineer','goal':'Build'})['result']['id']
        self.call('memory.save',{'id':'orchestrator','text':'Specialist memory'})
        def task():return self.call('task.create',{'title':'Mission','description':'Evidence','assignee':'','dependsOn':[],'needsApproval':False})['result']['id']
        done=task();self.call('begin',{'id':done});self.call('finish',{'id':done,'ok':True,'result':'Delivered'})
        pending=task();self.call('message',{'to':'orchestrator','text':'Pending coordination'})
        snapshot=self.call('orchestrator.set',{'id':worker})['snapshot']
        self.assertEqual([a['id'] for a in snapshot['agents'] if a['isDirector']],[worker])
        self.assertEqual(next(t for t in snapshot['tasks'] if t['id']==pending)['assignee'],worker)
        self.assertEqual(next(t for t in snapshot['tasks'] if t['id']==done)['assignee'],'orchestrator')
        self.assertEqual(self.call('memory',{'id':'orchestrator'})['result']['text'],'Specialist memory')
        self.assertIn('Pending coordination',str(self.call('mailbox.list',{'agent':worker})['result']))
        self.assertEqual(next(a for a in snapshot['agents'] if a['id']==worker)['role'],'Engineer')
        self.assertEqual(self.call('snapshot')['snapshot']['orchestratorId'],worker)
    def test_explicit_binding_is_idempotent_and_archive_survives_discovery(self):
        self.call('runtime.sync',{'agents':[{'runtime_id':'codex','name':'Odexi','role':'Architect'}], 'bindings':{'orchestrator':'codex'}})
        a=self.call('runtime.sync',{'agents':[{'runtime_id':'coder','name':'Mak','role':'Engineer'}]})['snapshot']
        worker=next(a['id'] for a in a['agents'] if a.get('runtime_id')=='coder')
        self.call('archive',{'id':worker})
        b=self.call('runtime.sync',{'agents':[{'runtime_id':'coder','name':'Mak','role':'Engineer'}]})['snapshot']
        self.assertNotIn(worker,[a['id'] for a in b['agents']])
        self.assertIn(worker,[a['id'] for a in b['archivedAgents']])
        self.call('restore',{'id':worker})
        self.assertEqual(len(self.call('snapshot')['snapshot']['agents']),2)
    def test_projection_merges_gateway_intake_and_keeps_workers(self):
        snap={'agents':[{'id':'o','runtime_id':'main','isDirector':False},{'id':'c','runtime_id':'codex','isDirector':True},{'id':'worker-one','name':'New worker','role':'Research','isDirector':False,'state':'idle'}]}
        rows=project(snap,[{'id':'rend--main','runtime_id':'main'},{'id':'rend--codex','runtime_id':'codex'}],'rend','main')
        self.assertEqual([r['id'] for r in rows],['rend','rend--codex','rend--worker-one'])
        self.assertEqual([r['id'] for r in rows if r['is_orchestrator']],['rend--codex'])
