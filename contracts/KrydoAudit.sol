// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title KrydoAudit
 * @notice Generic append-only audit log for Krydo off-chain events that
 *         need an on-chain anchor. Anyone can call `anchor(...)`; the
 *         contract stores nothing in state and simply emits an event with
 *         the (sender, kind, id, data) tuple indexed for cheap queries.
 *
 *         This exists because modern MetaMask blocks EOA -> EOA
 *         transactions that carry a `data` payload ("External transactions
 *         to internal accounts cannot include data"). Routing anchors
 *         through a real contract call makes them first-class transactions
 *         that MetaMask will sign normally.
 *
 *         Typical `kind` values (keccak256 of a short ASCII tag):
 *           - "KRYDO_CRED_REQUEST_V1"  - holder created a credential request
 *           - "KRYDO_ZK_PROOF_V2"      - holder generated a ZK proof
 *           - "KRYDO_CRED_RENEWAL_V1"  - issuer renewed a credential
 *           - "KRYDO_ROLE_ASSIGN_V1"   - role assignment audit
 *
 *         `id` is the off-chain row identifier (Firestore doc id hashed to
 *         bytes32, or a credentialHash for renewals).
 *
 *         `data` is arbitrary ABI-encoded metadata; consumers that care
 *         about the payload decode it off-chain using the same types the
 *         caller used to encode.
 */
contract KrydoAudit {
    event Anchor(
        address indexed sender,
        bytes32 indexed kind,
        bytes32 indexed id,
        bytes data,
        uint256 timestamp
    );

    /**
     * @notice Emit an audit anchor. Reverts-never, state-free.
     * @param kind Short tag identifying the event schema.
     * @param id   Off-chain row identifier (doc id hash, credential hash, etc.)
     * @param data ABI-encoded payload; may be empty for minimal anchors.
     */
    function anchor(bytes32 kind, bytes32 id, bytes calldata data) external {
        emit Anchor(msg.sender, kind, id, data, block.timestamp);
    }
}
