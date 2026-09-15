#!/usr/bin/env python3
"""Independent stdlib byte/digest fixture checker, NOT a full Python canonicalizer.

Verifies JS/Python parse agreement for these fixtures, UTF-8 bytes, and each role's
SHA-256 preimage. It deliberately hashes supplied canonical bytes, not json.dumps:
Python's default float formatting is NOT the ECMAScript serialization profile.
"""
import hashlib
import json
from pathlib import Path


def main():
    vectors = json.loads(Path(__file__).with_name("canonicalization-vectors.json").read_text())
    count = 0
    for item in vectors["accepted"]:
        wire = item["canonical"].encode("utf-8")
        assert wire.hex() == item["utf8Hex"], item["name"]
        assert json.loads(item["inputJson"]) == json.loads(item["canonical"]), item["name"]
        for role, expected in item["digests"].items():
            preimage = (vectors["profile"] + "\n" + role + "\n").encode() + wire
            assert hashlib.sha256(preimage).hexdigest() == expected, (item["name"], role)
            count += 1
    print(f"PASS: {len(vectors['accepted'])} cross-language byte fixtures; {count} role digests. Not a full canonicalizer.")


if __name__ == "__main__":
    main()
