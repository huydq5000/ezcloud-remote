#!/usr/bin/env python3
"""Serve the ezCloud Remote client download page."""

import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = "/var/www/ezcloud-remote"
PORT = 8088
PENDING = {}
PENDING_LOCK = threading.Lock()
PENDING_TTL = 180
TOKEN_CHARS = set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.=+/"
)

DONE_PAGE = """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập ezRemote</title>
  <style>
    body { margin: 0; background: #F4F7FC; color: #2D3E5C;
      font-family: "Be Vietnam Pro", "Segoe UI", sans-serif; }
    main { max-width: 32em; margin: 12vh auto; padding: 32px 28px;
      background: #fff; border: 1px solid #E4E9F0; border-radius: 12px; }
    h1 { margin: 0 0 8px; color: #0B3C82; font-size: 28px; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Đăng nhập thành công</h1>
    <p>Quay lại cửa sổ ezRemote. Bạn có thể đóng tab này.</p>
  </main>
</body>
</html>
"""

FAILED_PAGE = """<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Đăng nhập ezRemote</title>
  <style>
    body { margin: 0; background: #F4F7FC; color: #2D3E5C;
      font-family: "Be Vietnam Pro", "Segoe UI", sans-serif; }
    main { max-width: 32em; margin: 12vh auto; padding: 32px 28px;
      background: #fff; border: 1px solid #E4E9F0; border-radius: 12px; }
    h1 { margin: 0 0 8px; color: #0B3C82; font-size: 28px; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Đăng nhập chưa hoàn tất</h1>
    <p>Đóng tab này và bấm Đăng nhập trong ezRemote lần nữa.</p>
  </main>
</body>
</html>
"""


def clip(value, limit):
    value = (value or "")[:limit]
    if not value or any(char not in TOKEN_CHARS for char in value):
        return ""
    return value


def remember(state, code, error):
    state = clip(state, 256)
    code = clip(code, 2048)
    error = clip(error, 64)
    if not state or not (code or error):
        return False
    now = time.time()
    with PENDING_LOCK:
        expired = [key for key, item in PENDING.items() if item[2] <= now]
        for key in expired:
            del PENDING[key]
        PENDING[state] = (code, error, now + PENDING_TTL)
    return True


def take(state):
    state = clip(state, 256)
    if not state:
        return None
    now = time.time()
    with PENDING_LOCK:
        item = PENDING.get(state)
        if not item or item[2] <= now:
            PENDING.pop(state, None)
            return None
        code, error, _expiry = item
        del PENDING[state]
        return code, error


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def do_GET(self):
        parts = urlsplit(self.path)
        if parts.path.startswith("/auth/") and "?" in self.requestline:
            start, _, rest = self.requestline.partition("?")
            version = rest.rpartition(" ")[2]
            self.requestline = f"{start} {version}"
        if parts.path == "/auth/callback":
            self.auth_callback(parts.query)
            return
        if parts.path == "/auth/done":
            failed = "failed=1" in parts.query
            self.send_html(FAILED_PAGE if failed else DONE_PAGE)
            return
        if parts.path == "/auth/result":
            self.auth_result(parts.query)
            return
        super().do_GET()

    def auth_callback(self, query):
        fields = parse_qs(query, keep_blank_values=False)
        state = (fields.get("state") or [""])[0]
        code = (fields.get("code") or [""])[0]
        error = (fields.get("error") or [""])[0]
        if remember(state, code, error):
            target = "/auth/done?failed=1" if error or not code else "/auth/done"
        else:
            target = "/auth/done?failed=1"
        self.send_response(302)
        self.send_header("Location", target)
        self.end_headers()

    def auth_result(self, query):
        fields = parse_qs(query, keep_blank_values=False)
        found = take((fields.get("state") or [""])[0])
        if found is None:
            self.send_response(204)
            self.end_headers()
            return
        code, error = found
        payload = {"error": "denied"} if error or not code else {"code": code}
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, page):
        body = page.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/dl/"):
            name = path.rsplit("/", 1)[-1]
            self.send_header(
                "Content-Disposition", f'attachment; filename="{name}"'
            )
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    os.chdir(ROOT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
