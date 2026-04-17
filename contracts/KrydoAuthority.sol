// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract KrydoAuthority {
    address public rootAuthority;

    struct IssuerInfo {
        bool active;
        string name;
        uint256 approvedAt;
        uint256 revokedAt;
    }

    mapping(address => IssuerInfo) public issuerRegistry;
    address[] public issuerList;

    event IssuerApproved(address indexed issuer, string name, uint256 timestamp);
    event IssuerRevoked(address indexed issuer, uint256 timestamp);

    modifier onlyRoot() {
        require(msg.sender == rootAuthority, "Only root authority");
        _;
    }

    constructor() {
        rootAuthority = msg.sender;
    }

    function addIssuer(address _issuer, string calldata _name) external onlyRoot {
        require(!issuerRegistry[_issuer].active, "Already an active issuer");
        require(_issuer != address(0), "Invalid address");

        issuerRegistry[_issuer] = IssuerInfo({
            active: true,
            name: _name,
            approvedAt: block.timestamp,
            revokedAt: 0
        });

        bool exists = false;
        for (uint i = 0; i < issuerList.length; i++) {
            if (issuerList[i] == _issuer) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            issuerList.push(_issuer);
        }

        emit IssuerApproved(_issuer, _name, block.timestamp);
    }

    function revokeIssuer(address _issuer) external onlyRoot {
        require(issuerRegistry[_issuer].active, "Not an active issuer");

        issuerRegistry[_issuer].active = false;
        issuerRegistry[_issuer].revokedAt = block.timestamp;

        emit IssuerRevoked(_issuer, block.timestamp);
    }

    function isIssuer(address _addr) external view returns (bool) {
        return issuerRegistry[_addr].active;
    }

    function getIssuerInfo(address _addr) external view returns (bool active, string memory name, uint256 approvedAt, uint256 revokedAt) {
        IssuerInfo memory info = issuerRegistry[_addr];
        return (info.active, info.name, info.approvedAt, info.revokedAt);
    }

    function getIssuerCount() external view returns (uint256) {
        return issuerList.length;
    }

    function getIssuerAt(uint256 index) external view returns (address) {
        require(index < issuerList.length, "Index out of bounds");
        return issuerList[index];
    }
}
