#!/usr/bin/env python3
"""The feedback admin tool over HTTP: local access, the password sign-in from elsewhere (#271) and screenshots (#272)."""
import base64
import json
import os
import sys
import tempfile
import threading
import unittest
from http.client import HTTPConnection

TMP = tempfile.mkdtemp()
os.environ.update(FEEDBACK_FILE=os.path.join(TMP, "feedback.jsonl"), ADMIN_PASSWORD_FILE=os.path.join(TMP, "pw.json"),
                  ROOMS_FILE=os.path.join(TMP, "rooms.pickle"), PORT="8000")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server  # noqa: E402
from games import admin_auth  # noqa: E402

PASSWORD = "correct horse battery"
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 40).decode()
REMOTE = {"Host": "games.example", "X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.9"}


class AdminTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # any free port: the handler only compares the PORT setting with ADMIN_PORT, and builds the local Host names from it
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.httpd.ssl_context = None
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        server.REQUEST_HITS.clear()
        if os.path.exists(admin_auth.PASSWORD_FILE):
            os.remove(admin_auth.PASSWORD_FILE)

    def call(self, path, body=None, headers=None):
        conn = HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=10)
        headers = {"Host": "localhost:8000", **(headers or {})}
        conn.request("GET" if body is None else "POST", path, None if body is None else json.dumps(body), headers)
        r = conn.getresponse()
        raw = r.read()
        conn.close()
        return r.status, (json.loads(raw) if r.getheader("Content-Type", "").startswith("application/json") else raw), r

    def sign_in(self, password=PASSWORD):
        status, _, r = self.call("/api/admin/login", {"password": password}, REMOTE)
        cookie = r.getheader("Set-Cookie", "")
        return status, cookie, {**REMOTE, "Cookie": cookie.split(";")[0]}

    def test_local_needs_no_password(self):
        self.assertEqual(self.call("/api/admin/feedback")[0], 200)
        admin_auth.set_password(PASSWORD)
        status, data, _ = self.call("/api/admin/feedback")
        self.assertEqual((status, data["remote"]), (200, False))

    def test_elsewhere_is_not_found_without_a_password(self):
        for path in ("/admin.html", "/api/admin/feedback", "/api/admin/image?name=1-000000000000.png"):
            self.assertEqual(self.call(path, headers=REMOTE)[0], 404, path)
        self.assertEqual(self.call("/api/admin/login", {"password": PASSWORD}, REMOTE)[0], 404)

    def test_sign_in(self):
        admin_auth.set_password(PASSWORD)
        self.assertEqual(self.call("/admin.html", headers=REMOTE)[0], 200)
        self.assertEqual(self.call("/api/admin/feedback", headers=REMOTE)[0], 401)
        self.assertEqual(self.call("/api/admin/feedback/add", {"kind": "bug", "text": "no cookie"}, REMOTE)[0], 404)
        self.assertEqual(self.sign_in("wrong password!!")[0], 401)
        self.assertEqual(self.sign_in("\ud800" * 12)[0], 401)
        status, cookie, session = self.sign_in()
        self.assertEqual(status, 200)
        for flag in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/api/admin"):
            self.assertIn(flag, cookie)
        status, data, _ = self.call("/api/admin/feedback", headers=session)
        self.assertEqual((status, data["remote"]), (200, True))
        self.assertEqual(self.call("/api/admin/feedback/add", {"kind": "bug", "text": "added from afar"}, session)[0], 200)
        self.assertEqual(self.call("/api/admin/logout", {}, session)[0], 200)
        self.assertEqual(self.call("/api/admin/feedback", headers=session)[0], 401)

    def test_https_and_same_site_only(self):
        admin_auth.set_password(PASSWORD)
        _, _, session = self.sign_in()
        plain = {k: v for k, v in session.items() if k != "X-Forwarded-Proto"}
        self.assertEqual(self.call("/api/admin/feedback", headers=plain)[0], 404)
        other = {**session, "Origin": "https://evil.example"}
        self.assertEqual(self.call("/api/admin/feedback", headers=other)[0], 404)
        self.assertEqual(self.call("/api/admin/feedback/add", {"kind": "bug", "text": "forged"}, other)[0], 404)
        self.assertEqual(self.call("/api/admin/feedback", headers={**session, "Origin": "https://games.example"})[0], 200)

    def test_changing_the_password_ends_sessions(self):
        admin_auth.set_password(PASSWORD)
        _, _, session = self.sign_in()
        admin_auth.set_password("a different long one")
        self.assertEqual(self.call("/api/admin/feedback", headers=session)[0], 401)
        with self.assertRaises(ValueError):
            admin_auth.set_password("short")
        self.assertEqual(os.stat(admin_auth.PASSWORD_FILE).st_mode & 0o777, 0o600)

    def test_sign_in_is_rate_limited(self):
        admin_auth.set_password(PASSWORD)
        self.assertEqual([self.sign_in("wrong password!!")[0] for _ in range(6)], [401] * 5 + [429])

    def test_the_player_inbox_stays_local(self):
        self.assertEqual(self.call("/api/feedback")[0], 200)

    def test_screenshots(self):
        status, data, _ = self.call("/api/admin/feedback/add", {"kind": "bug", "text": "with a picture", "add_images": [PNG]})
        self.assertEqual(status, 200)
        report = data["id"]
        images = lambda: next(i for i in server.list_feedback()["items"] if i["id"] == report).get("images", [])
        name = images()[0]
        self.assertRegex(name, rf"^{report}-[0-9a-f]{{12}}\.png$")
        status, raw, r = self.call("/api/admin/image?name=" + name)
        self.assertEqual((status, r.getheader("Content-Type"), r.getheader("X-Content-Type-Options")), (200, "image/png", "nosniff"))
        self.assertTrue(raw.startswith(b"\x89PNG"))
        for bad in ("../pw.json", "..%2Fpw.json", name + "%00", ""):
            self.assertEqual(self.call("/api/admin/image?name=" + bad)[0], 404, bad)
        update = lambda **change: self.call("/api/admin/feedback/update", {"ids": [report], **change})[0]
        for bad in ("data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,bm90IGEgcG5n", "data:image/png;base64,!!", 7):
            self.assertEqual(update(add_images=[bad]), 400, bad)
        self.assertEqual(update(add_images=[PNG] * 4), 400)   # four more would make five
        self.assertEqual(images(), [name])
        self.assertEqual(update(add_images=[PNG], remove_images=[name]), 200)
        self.assertEqual(len(images()), 1)
        self.assertNotIn(name, images())
        self.assertFalse(os.path.exists(os.path.join(server.SHOT_DIR, name)))
        self.assertEqual(len(os.listdir(server.SHOT_DIR)), 1)
        before = os.listdir(server.SHOT_DIR)
        self.assertEqual(self.call("/api/admin/feedback/update", {"ids": [report, 99999], "add_images": [PNG]})[0], 400)
        self.assertEqual(os.listdir(server.SHOT_DIR), before)

    def test_import_merges_only_new_reports(self):
        items = [{"id": 7, "kind": "bug", "text": "Board is cut off", "at": 1000.5, "name": "Pat", "context": {"game": "chess"}, "status": "done"},
                 {"id": 8, "kind": "idea", "text": "Add a clock please", "at": 2000.0, "context": {}, "status": "open"},
                 {"id": 9, "kind": "nonsense", "text": "ignored", "at": 3.0}]
        body = {"source": "prod", "items": items}
        status, data, _ = self.call("/api/feedback/import", body)
        self.assertEqual((status, len(data["added"])), (200, 2))
        self.assertEqual(self.call("/api/feedback/import", body)[1]["added"], [])
        got = {e["id"]: e for e in self.call("/api/feedback")[1]["items"]}
        first, second = (got[i] for i in data["added"])
        self.assertEqual((first["origin"], first["at"], first["status"]), ({"source": "prod", "id": 7}, 1000.5, "done"))
        self.assertEqual(second["status"], "open")
        self.assertEqual(self.call("/api/feedback/import", body, REMOTE)[0], 404)


if __name__ == "__main__":
    unittest.main()
