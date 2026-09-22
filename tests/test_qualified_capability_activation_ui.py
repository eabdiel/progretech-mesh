import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class TestQualifiedCapabilityActivationUI(unittest.TestCase):
    def setUp(self):
        self.js = (ROOT / "static" / "js" / "capabilities.js").read_text(encoding="utf-8")
        self.html = (ROOT / "templates" / "capabilities.html").read_text(encoding="utf-8")

    def test_ui_supports_explicit_owner_activation(self):
        self.assertIn("activateQualifiedCapability", self.js)
        self.assertIn("owner_approved: true", self.js)
        self.assertIn("Activate capability?", self.js)

    def test_only_qualified_is_activatable(self):
        self.assertIn('item.state === "QUALIFIED"', self.js)
        self.assertIn('item.state === "ACTIVE"', self.js)

    def test_active_state_is_visually_exposed(self):
        self.assertIn("ACTIVE", self.js)
        self.assertIn("owner approval", self.html.lower())

if __name__ == "__main__":
    unittest.main()
