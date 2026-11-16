import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'bridge_server.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class ManifestTest(unittest.TestCase):
    def test_rename_identity_and_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            b.EXPORTS_DIR = Path(tmp)
            b.MANIFEST_FILE = Path(tmp) / 'export-manifest.json'
            b.PROJECT_ID = 'test'
            payload = {'document': {'id': 'file1', 'name': 'Original'}, 'node_path': [{'id': '1:2', 'name': 'Page'}, {'id': '2:3', 'name': 'Screen'}]}
            original = b.resolve_target(payload)
            payload['document']['name'] = 'Renamed'
            payload['node_path'][0]['name'] = 'Renamed page'
            payload['node_path'][1]['name'] = 'Renamed screen'
            self.assertEqual(original, b.resolve_target(payload))
            payload['document']['id'] = 'file2'
            self.assertNotEqual(original, b.resolve_target(payload))
            payload['node_path'][1]['id'] = '4:5'
            self.assertNotEqual(original, b.resolve_target(payload))
            with self.assertRaises(ValueError):
                b.contained_path(Path(tmp), ['..', 'escape'])
            with self.assertRaises(ValueError):
                b.resolve_target({'folder_path': ['old-plugin']})

class CheckpointTest(unittest.TestCase):
    def test_changes_and_missing_output(self):
        import hashlib, json
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            payload = {"content_hash": "before"}
            self.assertFalse(b.is_unchanged(payload, target))
            output = target / "spec.json"
            output.write_text("original")
            (target / ".export-checkpoint.json").write_text(json.dumps({"hash": "before", "files": [{"name": "spec.json", "hash": hashlib.sha256(output.read_bytes()).hexdigest()}]}))
            self.assertTrue(b.is_unchanged(payload, target))
            self.assertFalse(b.is_unchanged({"content_hash": "after"}, target))
            output.write_text("modified")
            self.assertFalse(b.is_unchanged(payload, target))
            output.unlink()
            self.assertFalse(b.is_unchanged(payload, target))

if __name__ == '__main__': unittest.main()
