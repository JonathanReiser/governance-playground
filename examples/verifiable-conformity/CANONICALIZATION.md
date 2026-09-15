# Canonicalization profile: verifiable-conformity/v1

This is a versioned restricted JSON profile, not a claim of conformance to another
canonicalization standard. Numbers use ECMAScript binary64 `Number` semantics,
base-10 Number serialization as used by `JSON.stringify`; strings use its string
quoting/escape semantics. The function is implemented in `server/verifiableConformity.js`.

## Exact scalar/container rules

- **Numbers:** finite binary64 values only; reject negative zero and every integer
  outside `[-9007199254740991, 9007199254740991]`. Positive zero emits `0`.
  Nonintegers use ECMAScript's shortest round-tripping decimal representation.
  The base-10 Number formatting rule uses fixed notation for magnitudes at least
  `1e-6` and below `1e21`, exponent notation outside it (with no exponent leading
  zeros and a `+` for positive exponents). In this restricted profile, values at
  `1e21` and the nearby large integer region are **rejected** as unsafe integers,
  not serialized. Thus `1e-6` emits `0.000001`, `1e-7` emits `1e-7`, and the smallest
  positive subnormal emits `5e-324`. Decimal input already rounded in a JS value
  cannot be recovered; the wire API rejects lexemes that do not match canonical output.
- **Strings:** quote `"` and backslash, use `\b`, `\t`, `\n`, `\f`, `\r` for
  those five controls; other U+0000–U+001F characters use lowercase `\u00xx`.
  Slash is not escaped. Other well-formed Unicode is literal, including U+2028,
  U+2029 and astral characters. Reject unpaired UTF-16 surrogates. Do not normalize
  Unicode: composed and decomposed forms remain distinct.
- **Keys:** order by unsigned UTF-16 code units, as ECMAScript default string sort,
  not UTF-8 bytes, locale or Unicode code-point order. Astral keys can sort before
  BMP keys above the surrogate range. Emit sorted keys directly; integer-like keys
  are not numerically reordered. `__proto__` is ordinary data.
- **Arrays:** preserve order and all elements. Empty array/object/string, booleans
  and null have their ordinary compact JSON representations.
- **In-memory exclusions:** undefined, functions, BigInt, nonfinite numbers,
  unsafe integers, negative zero, sparse/decorated/non-plain arrays, non-plain
  objects, accessors, nonenumerable/symbol properties and cycles.
- **Wire:** UTF-8, no BOM, no whitespace, no alternate escapes/lexemes/key order;
  at most one trailing LF is allowed for files and removed before hashing. Malformed
  UTF-8, duplicate keys (including escaped aliases), malformed JSON, trailing data,
  number overflow/underflow or rounding lexemes fail canonical roundtrip validation.

Limits apply before encoding: max canonical UTF-8 size 1,048,576 bytes, depth 64
(root depth 0), 20,000 value nodes and 4,096 members per object/array. Strings are
length-checked then scanned to count exact UTF-8/escape size. A bounded preflight
runs before building canonical strings. Wire decoding/parsing begins only after
input-size validation. Diagnostic comparison reports at most 100 specification
mismatches. These are resource controls, not a hostile-JavaScript sandbox.

Use strings under an explicit adapter schema for exact money or arbitrary-precision
numbers. Do not assume Python `json.dumps`, Go JSON or another runtime's default
number/key/string representation yields these bytes.

## Role-separated digests

For role in `model`, `inputs`, `policy`, `approval`, `output`, `manifest`, `evidence`:

```text
SHA256(UTF8("verifiable-conformity/v1" + LF + role + LF + canonical(value)))
```

No final LF inside the preimage. Digests use 64 lowercase hexadecimal characters.
Unknown roles are rejected. Evidence hashing omits only `evidenceHash`; manifest
hashing includes every field, including the blinding nonce and output constraint.
The demo's raw source-file hash separately uses ordinary SHA-256 over source UTF-8,
explicitly labeled as such; it is not one of the canonical artifact-role hashes.

## Cross-implementation fixtures

[canonicalization-vectors.json](canonicalization-vectors.json) contains:

- 12 accepted cases, each with authoring `inputJson`, exact canonical string,
  UTF-8 hex and seven independent role digest expectations (84 digests total).
- 20 rejected wire cases plus three malformed UTF-8 byte sequences.

Coverage includes floats, scientific notation boundaries, negative values, null,
booleans, nested arrays/objects, integer-like keys, Unicode normalization, astral
Unicode and UTF-16 sorting, escapes, every ASCII control character, zero and
rejected negative zero, safe integer edges and the smallest positive subnormal.
`inputJson` is fixture-authoring input, not necessarily acceptable protocol wire.

The Node tests compare the implementation against these frozen expected bytes and
hashes, and assert rejection cases. The independent stdlib Python
[check_vectors.py](check_vectors.py) checks parse agreement for accepted fixtures,
UTF-8 and SHA-256 preimages across all roles. It deliberately hashes the supplied
canonical bytes: **it is a byte/digest compatibility fixture, not a full independent
canonicalizer or protocol verifier**, and does not establish universal cross-language
numeric serialization compatibility. A new implementation must implement the full
profile and run these vectors plus its own edge/property tests.
