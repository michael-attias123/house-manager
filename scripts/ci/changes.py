#!/usr/bin/env python3
"""Which CI areas a push touches, as GitHub Actions outputs (area=true|false).

A branch is compared with where it left main (merge-base), so every push of
a branch tests everything the branch changes, not only its last commit. main
is compared with the previous main (the push's `before`). Anything unsure (a
manual run, a new or rewritten main, a failed git command) runs everything.

Usage: changes.py [--base REF]   (prints area=true|false lines)
       env: GITHUB_EVENT_NAME, GITHUB_REF_NAME, BEFORE (github.event.before)
"""
from __future__ import annotations

import os
import subprocess
import sys

# Path prefixes per CI job. A file under ALL runs every job.
AREAS: dict[str, tuple[str, ...]] = {
    "web": ("web/",),
    "database": ("supabase/migrations/", "supabase/tests/", "ingest/", "scripts/db-test.sh",
                 "infra/scripts/sync-vault.sh"),
    "functions": ("supabase/functions/",),
    # validate.py reads the runbook anchors in docs/setup.md and the contact
    # points in infra/modules/observability.
    "observability": ("observability/", "scripts/observability/", "docs/setup.md",
                      "infra/modules/observability/"),
}
ALL = (".github/workflows/ci.yml", "scripts/ci/")


def areas_for(files: list[str] | None) -> dict[str, bool]:
    """None means unknown: every area runs."""
    if files is None or any(f.startswith(ALL) for f in files):
        return {a: True for a in AREAS}
    return {a: any(f.startswith(prefixes) for f in files) for a, prefixes in AREAS.items()}


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def changed_files(event: str, branch: str, before: str, main: str = "origin/main") -> list[str] | None:
    try:
        if event != "push":
            return None
        if branch == "main":
            if not before or set(before) == {"0"}:
                return None
            _git("cat-file", "-e", f"{before}^{{commit}}")
            base = before
        else:
            base = _git("merge-base", main, "HEAD")
        return [f for f in _git("diff", "--name-only", base, "HEAD").splitlines() if f]
    except (subprocess.CalledProcessError, OSError):
        return None


def main() -> int:
    files = changed_files(os.environ.get("GITHUB_EVENT_NAME", ""), os.environ.get("GITHUB_REF_NAME", ""),
                          os.environ.get("BEFORE", ""))
    print(f"changed files: {'unknown, running everything' if files is None else len(files)}", file=sys.stderr)
    for area, run in areas_for(files).items():
        print(f"{area}={'true' if run else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
