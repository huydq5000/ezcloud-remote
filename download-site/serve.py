#!/usr/bin/env python3
"""Serve the ezCloud Remote client download page."""

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = "/var/www/ezcloud-remote"
PORT = 8088


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/dl/"):
            name = path.rsplit("/", 1)[-1]
            self.send_header(
                "Content-Disposition", f'attachment; filename="{name}"'
            )
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    os.chdir(ROOT)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
