"""Both Mesh front ends must ship the common memory surface and controls."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class ReleaseParityTests(unittest.TestCase):
    def test_shared_memory_ui_shipped_to_every_surface(self):
        for name in ('index','office','offline','control_center'):
            self.assertIn('/static/js/agent-memory.js',(ROOT/f'templates/{name}.html').read_text())
        desktop=(ROOT/'offline/app.py').read_text()
        self.assertIn("'/api/agents/<aid>/management'",desktop)
        self.assertIn("'memory.status'",desktop)
    def test_local_web_uses_same_owner_actions_and_release_source(self):
        source=(ROOT/'main.py').read_text()
        self.assertIn("MESH_LOCAL_CONTROL_CENTER",source)
        self.assertIn('GATEWAY_SOCKETS, management_send',source)
        installer=(ROOT/'scripts/install-local-release.py').read_text()
        self.assertIn('DEV_SEED_AGENTS=0',installer)
        self.assertIn('BUILD_ID={commit[:7]}',installer)
