import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[2] / 'infrastructure/scripts/backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupValidationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def archive(self, name='objects/ab/cd/file/v0001.bin', kind=tarfile.REGTYPE):
        with tarfile.open(self.root / 'storage.tar.gz', 'w:gz') as stream:
            item = tarfile.TarInfo(name)
            item.type = kind
            item.size = 3 if kind == tarfile.REGTYPE else 0
            item.linkname = '../../private'
            stream.addfile(item, io.BytesIO(b'abc') if item.size else None)

    def manifest(self):
        (self.root / 'database.dump').write_bytes(b'not a real database')
        (self.root / 'configuration.env').write_text('TEST_ONLY=1\n')
        names = ['database.dump', 'storage.tar.gz', 'configuration.env']
        (self.root / 'manifest.json').write_text(json.dumps({'format': 1, 'files': {n: hashlib.sha256((self.root / n).read_bytes()).hexdigest() for n in names}}))

    def test_valid_archive_and_checksums(self):
        self.archive()
        self.manifest()
        self.assertEqual(backup.inspect_backup(self.root)['format'], 1)

    def test_modified_backup_is_rejected(self):
        self.archive()
        self.manifest()
        (self.root / 'database.dump').write_bytes(b'modified')
        with self.assertRaises(ValueError):
            backup.inspect_backup(self.root)

    def test_absolute_and_parent_paths_are_rejected(self):
        for path in ['/etc/passwd', '../../outside', 'objects/../../outside']:
            with self.subTest(path=path):
                self.archive(path)
                with self.assertRaises(ValueError):
                    backup.validate_archive(self.root / 'storage.tar.gz')

    def test_symbolic_hard_links_and_special_files_are_rejected(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE]:
            with self.subTest(kind=kind):
                self.archive('file', kind)
                with self.assertRaises(ValueError):
                    backup.validate_archive(self.root / 'storage.tar.gz')


if __name__ == '__main__':
    unittest.main()
