#!/usr/bin/env python3
"""Publish client builds to the download host on 10.19.193.47.

Once, on a new host:

    python3 download-site/publish.py --init

Each release, put the installers and a manifest.json in one directory:

    python3 download-site/publish.py dist/1.5.1

manifest.json fields:

    version, product, server, key, source
    builds[]: os (windows|macos|linux), arch (x64|arm64|x86),
              label, file, and optional hint, pkg

`file` is the installer name inside that directory. The script fills in
bytes and sha256, uploads the files to /dl/, and replaces /manifest.json.
Files already on the host are left in place.

    EZCLOUD_DOWNLOAD_HOST  default ezit@10.19.193.47
    EZCLOUD_DOWNLOAD_DIR   default /var/www/ezcloud-remote
"""

import hashlib
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

HOST = os.environ.get("EZCLOUD_DOWNLOAD_HOST", "ezit@10.19.193.47")
REMOTE_DIR = os.environ.get("EZCLOUD_DOWNLOAD_DIR", "/var/www/ezcloud-remote")
HERE = Path(__file__).resolve().parent
OS_OK = {"windows", "macos", "linux"}
ARCH_OK = {"x64", "arm64", "x86"}
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HOST]


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def run(args):
    print("+ " + " ".join(shlex.quote(str(a)) for a in args))
    subprocess.run(args, check=True)


def load_manifest(dist):
    path = Path(dist) / "manifest.json"
    if not path.is_file():
        fail(f"missing {path}")
    try:
        manifest = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"{path}: {exc}")
    if not isinstance(manifest, dict):
        fail("manifest.json must be an object")
    version = manifest.get("version")
    if not isinstance(version, str) or not version.strip():
        fail("manifest.json needs a version")
    builds = manifest.get("builds")
    if not isinstance(builds, list) or not builds:
        fail("manifest.json needs a non-empty builds list")
    seen = set()
    for build in builds:
        if not isinstance(build, dict):
            fail("each build must be an object")
        os_name = build.get("os")
        arch = build.get("arch")
        label = build.get("label")
        filename = build.get("file")
        if os_name not in OS_OK:
            fail(f"os must be windows, macos, or linux: {os_name}")
        if arch not in ARCH_OK:
            fail(f"arch must be x64, arm64, or x86: {arch}")
        if not isinstance(label, str) or not label.strip():
            fail(f"build {filename} needs a label")
        if not isinstance(filename, str) or "/" in filename or filename.startswith("."):
            fail(f"bad file name: {filename}")
        if filename in seen:
            fail(f"duplicate file: {filename}")
        seen.add(filename)
        installer = Path(dist) / filename
        if not installer.is_file():
            fail(f"missing installer: {installer}")
        digest = hashlib.sha256()
        size = 0
        with installer.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        build["bytes"] = size
        build["sha256"] = digest.hexdigest()
    return manifest


def publish(dist):
    dist = Path(dist).resolve()
    if not dist.is_dir():
        fail(f"not a directory: {dist}")
    manifest = load_manifest(dist)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        manifest_path = tmp_path / "manifest.json"
        sums_path = tmp_path / "SHA256SUMS"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        lines = [
            f"{build['sha256']}  {build['file']}" for build in manifest["builds"]
        ]
        sums_path.write_text("\n".join(lines) + "\n")
        remote_dl = f"{HOST}:{REMOTE_DIR}/dl/"
        run(SSH + [f"mkdir -p {shlex.quote(REMOTE_DIR)}/dl"])
        files = [str(dist / build["file"]) for build in manifest["builds"]]
        run(["scp", "-o", "BatchMode=yes", *files, remote_dl])
        run(
            [
                "scp",
                "-o",
                "BatchMode=yes",
                str(HERE / "index.html"),
                str(manifest_path),
                str(sums_path),
                f"{HOST}:{REMOTE_DIR}/",
            ]
        )
    print(f"published {manifest['version']} ({len(manifest['builds'])} files)")


def init_host():
    run(SSH + ["python3 --version"])
    run(
        SSH
        + [
            "sudo -n mkdir -p /var/www/ezcloud-remote/dl",
            "&& sudo -n chown -R ezit:ezit /var/www/ezcloud-remote",
            "&& sudo -n ufw allow 8088/tcp",
        ]
    )
    run(
        [
            "scp",
            "-o",
            "BatchMode=yes",
            str(HERE / "serve.py"),
            f"{HOST}:/tmp/ezcloud-remote-download.py",
        ]
    )
    run(
        [
            "scp",
            "-o",
            "BatchMode=yes",
            str(HERE / "ezcloud-remote-download.service"),
            f"{HOST}:/tmp/ezcloud-remote-download.service",
        ]
    )
    run(
        SSH
        + [
            "sudo -n cp /tmp/ezcloud-remote-download.py /usr/local/bin/ezcloud-remote-download.py",
            "&& sudo -n chmod 755 /usr/local/bin/ezcloud-remote-download.py",
            "&& sudo -n cp /tmp/ezcloud-remote-download.service /etc/systemd/system/ezcloud-remote-download.service",
            "&& sudo -n systemctl daemon-reload",
            "&& sudo -n systemctl enable --now ezcloud-remote-download.service",
            "&& sudo -n systemctl is-active ezcloud-remote-download.service",
        ]
    )
    print("download host listening on :8088")


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--init":
        init_host()
        return
    if len(sys.argv) != 2:
        fail("usage: publish.py --init | publish.py <dist-dir>")
    publish(sys.argv[1])


if __name__ == "__main__":
    main()
