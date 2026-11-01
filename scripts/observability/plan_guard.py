#!/usr/bin/env python3
"""Lets the observability reconciler apply a saved plan only if every
resource change is inside module.observability or module.uptime.

Usage:
  tofu show -json tfplan > plan.json
  python scripts/observability/plan_guard.py plan.json   # or - for stdin

Exits 0 when the plan is safe to apply (no changes counts as safe), 1 when a
change falls outside those modules or the plan cannot be read. Data source
reads and no-ops write nothing and are ignored. Prints resource addresses
and actions only, never attribute values.
"""
from __future__ import annotations

import json
import sys

ALLOWED_MODULES = ("module.observability", "module.uptime")
IGNORED_ACTIONS = ({"no-op"}, {"read"})


def in_scope(address: str) -> bool:
    return any(address == m or address.startswith((m + ".", m + "[")) for m in ALLOWED_MODULES)


def changes(plan: dict) -> list[tuple[str, str]]:
    """(address, action) for each resource the plan would write."""
    out = []
    for rc in plan.get("resource_changes") or []:
        actions = (rc.get("change") or {}).get("actions") or []
        if set(actions) in IGNORED_ACTIONS:
            continue
        out.append((str(rc.get("address", "?")), "-".join(actions) or "?"))
    return out


def check(plan: object) -> tuple[list[tuple[str, str]], list[str]]:
    """The changes, and the problems that forbid applying them."""
    if not isinstance(plan, dict) or "format_version" not in plan:
        return [], ["not the output of `tofu show -json <planfile>`"]
    problems = []
    if plan.get("errored"):
        problems.append("the plan errored")
    found = changes(plan)
    for address, action in found:
        if not in_scope(address):
            problems.append(f"{action} {address} is outside {' and '.join(ALLOWED_MODULES)}")
    return found, problems


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: plan_guard.py <plan.json | ->", file=sys.stderr)
        return 1
    try:
        if argv[0] == "-":
            plan = json.load(sys.stdin)
        else:
            with open(argv[0], encoding="utf-8") as f:
                plan = json.load(f)
    except (OSError, ValueError) as exc:
        print(f"plan_guard: cannot read the plan: {exc.__class__.__name__}", file=sys.stderr)
        return 1
    found, problems = check(plan)
    for address, action in found:
        print(f"  {action} {address}")
    if problems:
        for problem in problems:
            print(f"::error::plan_guard: {problem}")
        print("plan_guard: refused; apply the whole configuration through infra.yml instead.")
        return 1
    print(f"plan_guard: {len(found)} change(s), all inside {' and '.join(ALLOWED_MODULES)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
