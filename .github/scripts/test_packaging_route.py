import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('packaging_route.sh').resolve()


class PackagingRouteTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def route(self, event, manual=''):
        env = dict(os.environ, GITHUB_EVENT_NAME=event, MANUAL_PACKAGE=manual,
                   RUNNER_TEMP=str(self.root))
        return subprocess.check_output(['bash', SCRIPT], cwd=self.root,
                                       env=env, text=True).strip()

    def git(self, *args):
        subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
                        '-c', 'commit.gpgsign=false', *args], cwd=self.root, check=True,
                       stdout=subprocess.DEVNULL)

    def commit(self, path, text, message):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
        self.git('add', '-A')
        self.git('commit', '-qm', message)

    def test_pr_changes(self):
        self.git('init', '-q')
        asset = self.root / 'src/ruru/src-tauri/icons/source/README.md'
        asset.parent.mkdir(parents=True)
        asset.write_text('icons')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.commit('src/ruru/src/main.tsx', 'change', 'ordinary')
        self.assertEqual(self.route('pull_request'), 'package=false')
        asset.rename(self.root / 'README.md')
        self.git('add', '-A')
        self.git('commit', '-qm', 'move bundle input')
        self.assertEqual(self.route('pull_request'), 'package=true')

    def test_rust_source_links_without_bundling(self):
        self.git('init', '-q')
        self.commit('README.md', 'base', 'base')
        self.commit('src/ruru/src-tauri/src/lib.rs', 'fn main() {}', 'rust')
        self.assertEqual(self.route('pull_request'), 'package=false')

    def test_packaging_inputs_bundle(self):
        self.git('init', '-q')
        self.commit('README.md', 'base', 'base')
        for path in ('src/ruru/src-tauri/tauri.conf.json', 'src/ruru/src-tauri/src/bin/tool.rs',
                     '.github/workflows/ci.yml', '.github/scripts/packaging_route.sh',
                     'src/ruru/package.json', 'package-lock.json'):
            with self.subTest(path=path):
                self.commit(path, f'change {path}', path)
                self.assertEqual(self.route('pull_request'), 'package=true')

    def test_dispatch_and_release(self):
        self.assertEqual(self.route('workflow_dispatch', 'false'), 'package=false')
        self.assertEqual(self.route('workflow_dispatch', 'true'), 'package=true')
        self.assertEqual(self.route('push'), 'package=true')
