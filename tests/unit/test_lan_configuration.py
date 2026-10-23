import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('configure_lan', Path(__file__).resolve().parents[2] / 'infrastructure/scripts/configure-lan.py')
lan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lan)


class LanConfigurationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.original = '# Keep configuration\nDATABASE_URL=postgresql://example\nPOSTGRES_PASSWORD=not-a-real-credential\nDATA_ROOT=/srv/ventilyator\nAPP_ORIGIN=https://ventilyator.company.local\nCOMPOSE_FILE=docker-compose.yml:.local/compose.server.yml\n'
        (self.root / '.env').write_text(self.original)

    def test_existing_credentials_and_data_paths_are_preserved(self):
        self.assertEqual(lan.configure(self.root, '192.168.1.50'), 'http://192.168.1.50')
        result = (self.root / '.env').read_text()
        for line in self.original.splitlines():
            if not line.startswith('COMPOSE_FILE='):
                self.assertIn(line, result)
        self.assertIn('COMPOSE_FILE=docker-compose.yml:docker-compose.lan.yml', result)
        self.assertEqual((self.root / '.env').stat().st_mode & 0o777, 0o600)

    def test_original_backup_is_private_and_never_overwritten(self):
        lan.configure(self.root, '192.168.1.50')
        backup = self.root / '.local/env.before-lan-http'
        self.assertEqual(backup.read_text(), self.original)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        lan.configure(self.root, '192.168.1.60')
        self.assertEqual(backup.read_text(), self.original)

    def test_repeated_call_is_idempotent(self):
        lan.configure(self.root, '192.168.1.50')
        result = (self.root / '.env').read_bytes()
        lan.configure(self.root, '192.168.1.50')
        self.assertEqual((self.root / '.env').read_bytes(), result)

    def test_custom_port_matches_browser_origin(self):
        self.assertEqual(lan.configure(self.root, '10.0.0.5', 8080), 'http://10.0.0.5:8080')
        self.assertIn('LAN_HTTP_PORT=8080', (self.root / '.env').read_text())

    def test_public_loopback_and_invalid_addresses_are_rejected(self):
        for address in ['8.8.8.8', '127.0.0.1', '0.0.0.0', 'example.org', '::1']:
            with self.subTest(address=address), self.assertRaises(ValueError):
                lan.configure(self.root, address)
        self.assertEqual((self.root / '.env').read_text(), self.original)

    def test_invalid_ports_are_rejected(self):
        for port in [0, 65536]:
            with self.subTest(port=port), self.assertRaises(ValueError):
                lan.configure(self.root, '192.168.1.50', port)

    def test_symlink_env_is_rejected(self):
        (self.root / '.env').rename(self.root / 'other')
        (self.root / '.env').symlink_to(self.root / 'other')
        with self.assertRaises(ValueError):
            lan.configure(self.root, '192.168.1.50')
        self.assertEqual((self.root / 'other').read_text(), self.original)

    def test_missing_installation_is_not_initialized(self):
        (self.root / '.env').unlink()
        with self.assertRaises(ValueError):
            lan.configure(self.root, '192.168.1.50')


if __name__ == '__main__':
    unittest.main()
