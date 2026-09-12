from __future__ import annotations

import os

from .base import AgentIdentityVerifier, IdentityVerification


class CodeSealIdentityVerifier(AgentIdentityVerifier):
    """
    Production integration boundary.

    Do not convert this into a permissive fallback. Until the actual CodeSeal
    cryptographic verification contract/keys/SDK are configured, production
    verification must fail closed.
    """
    name = "codeseal"

    def verify(self, assertion):
        verifier_mode = os.environ.get("CODESEAL_VERIFIER_MODE", "unconfigured").strip().lower()

        if verifier_mode != "configured":
            return IdentityVerification(
                ok=False,
                provider=self.name,
                error="Production CodeSeal verifier is not configured",
                metadata={
                    "cryptographic_verification": False,
                    "fail_closed": True,
                },
            )

        # The real CodeSeal verification call belongs here once its supported
        # cryptographic API/SDK contract is available.
        return IdentityVerification(
            ok=False,
            provider=self.name,
            error="CodeSeal cryptographic adapter contract not installed",
            metadata={
                "cryptographic_verification": False,
                "fail_closed": True,
            },
        )
