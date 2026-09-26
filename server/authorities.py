"""Proof-of-Authority authorities for the BUSTARON M3 chain (PRD §9.1, FR-B5).

Three authorities — Admin, Agent-A host and Agent-B host — hold the Ed25519 key
pairs that co-sign every block. The trust model is that no single authority can
anchor a block alone: `verify_quorum()` demands a valid signature from each of the
three, and from no one else.

Key material
------------
* **Dev (default).** Seeds are DERIVED deterministically from `DEV_SEED_SALT`, so a
  dev chain is reproducible from code alone — no key files, nothing to commit.
* **Override.** Any authority's seed can be supplied as `BUSTARON_AUTHORITY_<ID>_SEED`
  (64 hex chars = 32 bytes), e.g. `BUSTARON_AUTHORITY_NODE_ADMIN_SEED`.
* **Production (`BUSTARON_ENV=production`).** Those env seeds are REQUIRED; a missing
  or malformed one raises `AuthorityConfigError` at import. Production never falls
  back to the dev keys.

What is signed
--------------
`sign_block_hash()` signs the ASCII bytes of a block's `hash` string. `hash` is
computed over `{height, prev_hash, ts_ms, txs}` and deliberately EXCLUDES `sigs`
(and `proposer`) — see `main._hash`. That keeps the signature set outside the signed
payload, so `hash` never depends on `sigs` while `sigs` sign `hash` (no cycle).
"""

from __future__ import annotations

import hashlib
import logging
import os
from collections.abc import Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

logger = logging.getLogger("bustaron.authorities")

DEV_SEED_SALT = b"bustaron-dev-authority-v1"
"""Salt for the deterministic dev seeds. Changing it rotates every dev authority key."""

ENV_SEED_PREFIX = "BUSTARON_AUTHORITY_"
ENV_SEED_SUFFIX = "_SEED"

#: (authority id, human role) in PRD §9.1 order. Ids match `Block.proposer` / §9.2 `sigs`.
AUTHORITY_SPECS: tuple[tuple[str, str], ...] = (
    ("node:admin", "Admin"),
    ("node:agent_a", "Agent-A host"),
    ("node:agent_b", "Agent-B host"),
)


class AuthorityConfigError(RuntimeError):
    """Raised when required authority key configuration is missing or malformed."""


class Authority:
    """One PoA authority holding an Ed25519 key pair."""

    def __init__(self, authority_id: str, role: str, seed: bytes) -> None:
        self.id = authority_id
        self.role = role
        self._private_key = Ed25519PrivateKey.from_private_bytes(seed)
        self.public_key_hex = (
            self._private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        )

    def sign(self, message: str) -> str:
        """Returns the hex Ed25519 signature over `message` (a block hash)."""
        return self._private_key.sign(message.encode("utf-8")).hex()

    def verify(self, message: str, signature_hex: str) -> bool:
        """True when `signature_hex` is this authority's valid signature over `message`."""
        return verify_signature(self.public_key_hex, message, signature_hex)

    def __repr__(self) -> str:
        """Never leaks the private key."""
        return f"Authority(id={self.id!r}, role={self.role!r}, public_key_hex={self.public_key_hex!r})"


def verify_signature(public_key_hex: str, message: str, signature_hex: str) -> bool:
    """Verifies `signature_hex` over `message` against a hex Ed25519 public key.

    Returns False — never raises — for a malformed key or signature, INCLUDING a
    non-string one: `bytes.fromhex` rejects a non-str with `TypeError`, which is caught
    here as well (defence in depth, so a hostile `sigs` payload cannot crash
    verification). `message` is always a block hash and is a `str` by the `Block` schema.
    """
    try:
        public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        public_key.verify(bytes.fromhex(signature_hex), message.encode("utf-8"))
    except (InvalidSignature, ValueError, TypeError):
        return False
    return True


def _env_var_name(authority_id: str) -> str:
    """`node:agent_a` -> `BUSTARON_AUTHORITY_NODE_AGENT_A_SEED`."""
    return f"{ENV_SEED_PREFIX}{authority_id.replace(':', '_').upper()}{ENV_SEED_SUFFIX}"


def _dev_seed(authority_id: str) -> bytes:
    """Deterministic 32-byte dev seed, so a dev chain is reproducible from code."""
    return hashlib.sha256(DEV_SEED_SALT + authority_id.encode("utf-8")).digest()


#: Authority ids that fell back to the public dev seeds, in resolution order.
#: Populated by `_resolve_seed()` while `AUTHORITIES` is built at import, then read
#: exactly once by the loud warning below. Empty whenever every seed was supplied.
_DEV_FALLBACK_IDS: list[str] = []


def _resolve_seed(authority_id: str) -> bytes:
    """Resolves one authority's seed from the environment, or the dev fallback.

    Raises `AuthorityConfigError` for a malformed env seed and — under
    `BUSTARON_ENV=production` — for a missing one. Every fallback to the PUBLIC dev
    seed is recorded in `_DEV_FALLBACK_IDS` so the module can warn once, loudly, at
    import: an operator who leaves `BUSTARON_ENV` unset (or mistypes it) must not
    silently run keys that anyone with the source can forge.
    """
    env_name = _env_var_name(authority_id)
    raw = os.environ.get(env_name, "").strip()
    if raw:
        try:
            seed = bytes.fromhex(raw)
        except ValueError as exc:
            raise AuthorityConfigError(f"{env_name} must be 64 hex characters (32 bytes)") from exc
        if len(seed) != 32:
            raise AuthorityConfigError(f"{env_name} must decode to 32 bytes, got {len(seed)}")
        return seed
    if os.environ.get("BUSTARON_ENV", "").strip().lower() == "production":
        raise AuthorityConfigError(
            f"{env_name} is required when BUSTARON_ENV=production — no dev key fallback in production"
        )
    _DEV_FALLBACK_IDS.append(authority_id)
    return _dev_seed(authority_id)


AUTHORITIES: tuple[Authority, ...] = tuple(
    Authority(authority_id, role, _resolve_seed(authority_id)) for authority_id, role in AUTHORITY_SPECS
)
"""The three PoA authorities (PRD §9.1). Built at import; fails loudly if misconfigured."""

# Fail LOUD, but do not fail: a dev box with BUSTARON_ENV unset is legitimate, yet an
# operator who MEANT production and mistyped the env var would otherwise silently run
# forgeable keys. Warn once at import, naming the exact vars to set. A partial override
# (some seeds supplied, some not) warns about the remainder — a mixed key set is not a
# valid production configuration either.
if _DEV_FALLBACK_IDS:
    logger.warning(
        "PoA authorities %s are using the PUBLIC, deterministic DEV seeds because "
        "BUSTARON_ENV is not 'production'. These keys are derived from this source and are "
        "FORGEABLE by anyone who has it — never deploy this configuration. Set %s (64 hex "
        "characters each) plus BUSTARON_ENV=production to use real keys.",
        ", ".join(_DEV_FALLBACK_IDS),
        ", ".join(_env_var_name(authority_id) for authority_id in _DEV_FALLBACK_IDS),
    )

AUTHORITY_IDS: tuple[str, ...] = tuple(authority.id for authority in AUTHORITIES)

AUTHORITY_BY_ID: dict[str, Authority] = {authority.id: authority for authority in AUTHORITIES}


def sign_block_hash(block_hash: str) -> dict[str, str]:
    """Collects the 3-of-3 authority signatures over `block_hash` (PRD FR-B5)."""
    return {authority.id: authority.sign(block_hash) for authority in AUTHORITIES}


def verify_quorum(block_hash: str, sigs: Mapping[str, str]) -> bool:
    """True iff `sigs` is a valid 3-of-3 quorum over `block_hash`.

    Requires EXACTLY the three known authority ids — an unknown, missing or extra id
    is rejected. Distinctness is structural: `sigs` is a mapping keyed by authority
    id, so three entries cannot come from one authority (a JSON object collapses
    duplicate keys on parse). Every present signature must verify.
    """
    # C1: a hostile `sigs` (an int, None, a list, a str) has no `.keys()` — reject it
    # instead of raising AttributeError. Defence in depth behind the Block schema.
    if not isinstance(sigs, Mapping):
        return False
    if set(sigs.keys()) != set(AUTHORITY_IDS):
        return False
    return all(
        AUTHORITY_BY_ID[authority_id].verify(block_hash, sigs[authority_id])
        for authority_id in AUTHORITY_IDS
    )
