import unittest
from unittest.mock import patch
from types import SimpleNamespace
import mesh_media_runtime as rt

class TestPT049BMediaRuntime(unittest.TestCase):
    def test_prompt_required(self):
        with self.assertRaisesRegex(ValueError,"prompt_required"):
            rt._validate_prompt("")

    def test_prompt_bounded(self):
        with self.assertRaisesRegex(ValueError,"prompt_too_long"):
            rt._validate_prompt("x"*1201)

    def test_role_script_mapping(self):
        self.assertTrue(str(rt._script_for_role("image_generation")).endswith("media-image-generate.py"))
        self.assertTrue(str(rt._script_for_role("video_generation")).endswith("media-video-generate.py"))
        self.assertTrue(str(rt._script_for_role("music_generation")).endswith("media-music-generate.py"))

    def test_no_route_fails_closed(self):
        with patch("mesh_media_runtime.router.resolve_media_intent",return_value=None):
            x=rt.invoke_intent("discuss images")
            self.assertFalse(x.ok)
            self.assertEqual(x.metadata["error"],"no_unambiguous_active_media_route")

    def test_recheck_active_gate(self):
        route=SimpleNamespace(role="image_generation",capability_id="animagine-xl-3.1")
        with patch("mesh_media_runtime.router.resolve_media_intent",return_value=route), \
             patch("mesh_media_runtime.router.resolve_active_role",return_value=None):
            with self.assertRaisesRegex(PermissionError,"not_active"):
                rt.invoke_intent("make an image")

if __name__=="__main__":
    unittest.main()
