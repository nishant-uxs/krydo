// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKrydoAuthority {
    function isIssuer(address _addr) external view returns (bool);
    function rootAuthority() external view returns (address);
}

contract KrydoCredentials {
    IKrydoAuthority public authority;

    enum CredentialStatus { None, Active, Revoked }

    struct Credential {
        address issuer;
        address holder;
        string claimType;
        string claimSummary;
        CredentialStatus status;
        uint256 issuedAt;
        uint256 revokedAt;
    }

    mapping(bytes32 => Credential) public credentials;
    bytes32[] public credentialHashes;

    mapping(address => bytes32[]) public holderCredentials;
    mapping(address => bytes32[]) public issuerCredentials;

    event CredentialIssued(bytes32 indexed hash, address indexed issuer, address indexed holder, string claimType, uint256 timestamp);
    event CredentialRevoked(bytes32 indexed hash, address indexed revoker, uint256 timestamp);

    modifier onlyIssuer() {
        require(authority.isIssuer(msg.sender), "Not an approved issuer");
        _;
    }

    constructor(address _authority) {
        authority = IKrydoAuthority(_authority);
    }

    function issueCredential(
        bytes32 _hash,
        address _holder,
        string calldata _claimType,
        string calldata _claimSummary
    ) external onlyIssuer {
        require(credentials[_hash].status == CredentialStatus.None, "Credential hash already exists");
        require(_holder != address(0), "Invalid holder address");

        credentials[_hash] = Credential({
            issuer: msg.sender,
            holder: _holder,
            claimType: _claimType,
            claimSummary: _claimSummary,
            status: CredentialStatus.Active,
            issuedAt: block.timestamp,
            revokedAt: 0
        });

        credentialHashes.push(_hash);
        holderCredentials[_holder].push(_hash);
        issuerCredentials[msg.sender].push(_hash);

        emit CredentialIssued(_hash, msg.sender, _holder, _claimType, block.timestamp);
    }

    function revokeCredential(bytes32 _hash) external {
        Credential storage cred = credentials[_hash];
        require(cred.status == CredentialStatus.Active, "Credential not active");
        require(
            cred.issuer == msg.sender || authority.rootAuthority() == msg.sender,
            "Only issuer or root can revoke"
        );

        cred.status = CredentialStatus.Revoked;
        cred.revokedAt = block.timestamp;

        emit CredentialRevoked(_hash, msg.sender, block.timestamp);
    }

    function verifyCredential(bytes32 _hash) external view returns (
        bool valid,
        address issuer,
        address holder,
        string memory claimType,
        string memory claimSummary,
        uint256 issuedAt,
        bool issuerActive
    ) {
        Credential memory cred = credentials[_hash];
        bool isActive = cred.status == CredentialStatus.Active;
        bool issuerStillActive = authority.isIssuer(cred.issuer);

        return (
            isActive,
            cred.issuer,
            cred.holder,
            cred.claimType,
            cred.claimSummary,
            cred.issuedAt,
            issuerStillActive
        );
    }

    function getCredentialCount() external view returns (uint256) {
        return credentialHashes.length;
    }

    function getHolderCredentialCount(address _holder) external view returns (uint256) {
        return holderCredentials[_holder].length;
    }

    function getHolderCredentialAt(address _holder, uint256 index) external view returns (bytes32) {
        require(index < holderCredentials[_holder].length, "Index out of bounds");
        return holderCredentials[_holder][index];
    }

    function getIssuerCredentialCount(address _issuer) external view returns (uint256) {
        return issuerCredentials[_issuer].length;
    }

    function getIssuerCredentialAt(address _issuer, uint256 index) external view returns (bytes32) {
        require(index < issuerCredentials[_issuer].length, "Index out of bounds");
        return issuerCredentials[_issuer][index];
    }
}
