import unittest
import main

class TestPT049LargeModelRelay(unittest.TestCase):
    def test_rend_exposes_qualified_specialist_aliases(self):
        self.assertEqual(
            main.ide_models("rend"),
            [
                "rend",
                "rend-code",
                "rend-fast",
                "rend-llama-review",
                "rend-architect",
                "rend-research",
            ],
        )

    def test_other_agents_do_not_inherit_rend_specialists(self):
        self.assertEqual(main.ide_models("mak"), ["mak", "mak-code", "mak-fast"])
        self.assertEqual(main.ide_models("lyra"), ["lyra", "lyra-code", "lyra-fast"])
        self.assertNotIn("rend-research", main.ide_models("mak"))

    def test_research_alias_is_allowlisted_only_as_explicit_model_name(self):
        self.assertIn("rend-research", main.ide_models("rend"))
        self.assertNotIn("rend-research", main.ide_models("lyra"))

if __name__ == "__main__":
    unittest.main()
