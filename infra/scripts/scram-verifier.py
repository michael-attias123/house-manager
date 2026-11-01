#!/usr/bin/env python3
"""Prints a PostgreSQL SCRAM-SHA-256 verifier for the password on stdin.

    printf %s "$password" | python3 infra/scripts/scram-verifier.py

The output (SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>) goes into
`alter role ... password '<verifier>'`: Postgres stores it as is, so the
plaintext never reaches the server or its logs. Same algorithm as libpq's
PQencryptPasswordConn (RFC 5802/7677, 4096 iterations, 16-byte salt).

Standard library only. SASLprep is not applied, so the password must be
printable ASCII (encrypt-secrets.sh generates letters and digits).
"""

import base64
import hashlib
import hmac
import os
import sys

ITERATIONS = 4096
SALT_BYTES = 16


def verifier(password: bytes, salt: bytes, iterations: int = ITERATIONS) -> str:
    salted = hashlib.pbkdf2_hmac("sha256", password, salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def main() -> int:
    password = sys.stdin.buffer.read()
    if password.endswith(b"\n"):
        password = password[:-1]
    if not password:
        print("scram-verifier: empty password on stdin", file=sys.stderr)
        return 1
    if any(c < 0x21 or c > 0x7E for c in password):
        print("scram-verifier: the password must be printable ASCII without spaces", file=sys.stderr)
        return 1
    print(verifier(password, os.urandom(SALT_BYTES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
