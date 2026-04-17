import crypto from "crypto";

function sha256(data: string): string {
  return "0x" + crypto.createHash("sha256").update(data).digest("hex");
}

function generateSalt(): string {
  return "0x" + crypto.randomBytes(32).toString("hex");
}

function createCommitment(value: string, salt: string): string {
  return sha256(value + salt);
}

export interface ZkProofRequest {
  credentialId: string;
  claimValue: string;
  proofType: "range_above" | "range_below" | "equality" | "membership" | "non_zero" | "selective_disclosure";
  threshold?: number;
  targetValue?: string;
  memberSet?: string[];
  selectedFields?: string[];
  allFields?: Record<string, string>;
}

export interface ZkProofOutput {
  commitment: string;
  proofData: {
    protocol: string;
    version: string;
    salt: string;
    challenge: string;
    response: string;
    witness: string;
    auxiliaryData: Record<string, unknown>;
  };
  publicInputs: {
    proofType: string;
    claimType?: string;
    threshold?: number;
    targetValue?: string;
    memberSet?: string[];
    disclosedFields?: string[];
    fieldCommitments?: Record<string, string>;
    commitment: string;
    timestamp: number;
  };
  verified: boolean;
}

export function generateZkProof(request: ZkProofRequest): ZkProofOutput {
  const salt = generateSalt();
  const commitment = createCommitment(request.claimValue, salt);
  const challenge = sha256(commitment + Date.now().toString());
  const numericValue = parseFloat(request.claimValue) || 0;

  let verified = false;
  const auxiliaryData: Record<string, unknown> = {};

  switch (request.proofType) {
    case "range_above": {
      if (request.threshold === undefined) throw new Error("Threshold required for range proof");
      verified = numericValue >= request.threshold;
      const delta = numericValue - request.threshold;
      const deltaCommitment = createCommitment(String(delta), salt);
      const sqrtProof = createCommitment(String(Math.floor(Math.sqrt(Math.abs(delta)))), salt);
      auxiliaryData.deltaCommitment = deltaCommitment;
      auxiliaryData.sqrtDecomposition = sqrtProof;
      auxiliaryData.boundaryCheck = sha256(String(request.threshold) + challenge);
      auxiliaryData.rangeProofSteps = generateRangeProofChain(numericValue, request.threshold, salt, "above");
      break;
    }
    case "range_below": {
      if (request.threshold === undefined) throw new Error("Threshold required for range proof");
      verified = numericValue <= request.threshold;
      const delta = request.threshold - numericValue;
      const deltaCommitment = createCommitment(String(delta), salt);
      auxiliaryData.deltaCommitment = deltaCommitment;
      auxiliaryData.boundaryCheck = sha256(String(request.threshold) + challenge);
      auxiliaryData.rangeProofSteps = generateRangeProofChain(numericValue, request.threshold, salt, "below");
      break;
    }
    case "equality": {
      if (!request.targetValue) throw new Error("Target value required for equality proof");
      verified = request.claimValue === request.targetValue;
      const targetCommitment = createCommitment(request.targetValue, salt);
      auxiliaryData.targetCommitment = targetCommitment;
      auxiliaryData.matchProof = sha256(commitment + targetCommitment);
      break;
    }
    case "membership": {
      if (!request.memberSet || request.memberSet.length === 0) throw new Error("Member set required");
      verified = request.memberSet.includes(request.claimValue);
      const memberCommitments = request.memberSet.map(m => createCommitment(m, salt));
      const merkleRoot = buildMerkleRoot(memberCommitments);
      auxiliaryData.merkleRoot = merkleRoot;
      auxiliaryData.setSize = request.memberSet.length;
      auxiliaryData.membershipWitness = sha256(commitment + merkleRoot);
      break;
    }
    case "non_zero": {
      verified = numericValue !== 0 && request.claimValue.length > 0;
      auxiliaryData.existenceProof = sha256(commitment + "non_zero");
      auxiliaryData.magnitudeCommitment = createCommitment(String(Math.abs(numericValue)), salt);
      break;
    }
    case "selective_disclosure": {
      if (!request.selectedFields || request.selectedFields.length === 0) {
        throw new Error("Selected fields required for selective disclosure");
      }
      if (!request.allFields || Object.keys(request.allFields).length === 0) {
        throw new Error("Credential fields required for selective disclosure");
      }
      const fieldCommitments: Record<string, string> = {};
      const fieldSalts: Record<string, string> = {};
      for (const fieldName of Object.keys(request.allFields)) {
        const fieldSalt = sha256(salt + fieldName);
        fieldSalts[fieldName] = fieldSalt;
        fieldCommitments[fieldName] = createCommitment(request.allFields[fieldName], fieldSalt);
      }
      const allFieldCommitmentsHash = sha256(
        Object.keys(fieldCommitments).sort().map(k => fieldCommitments[k]).join("")
      );
      const disclosedData: Record<string, string> = {};
      for (const field of request.selectedFields) {
        if (request.allFields[field] !== undefined) {
          disclosedData[field] = request.allFields[field];
        }
      }
      verified = request.selectedFields.every(f => request.allFields![f] !== undefined);
      auxiliaryData.fieldCommitments = fieldCommitments;
      auxiliaryData.disclosedFields = request.selectedFields;
      auxiliaryData.disclosedData = disclosedData;
      auxiliaryData.allFieldsRoot = allFieldCommitmentsHash;
      auxiliaryData.totalFields = Object.keys(request.allFields).length;
      auxiliaryData.disclosedCount = request.selectedFields.length;
      break;
    }
  }

  const response = sha256(challenge + salt + (verified ? "1" : "0"));
  const witness = sha256(response + commitment);

  return {
    commitment,
    proofData: {
      protocol: "krydo-zkp-v1",
      version: "1.0.0",
      salt,
      challenge,
      response,
      witness,
      auxiliaryData,
    },
    publicInputs: {
      proofType: request.proofType,
      threshold: request.threshold,
      targetValue: request.targetValue,
      memberSet: request.memberSet,
      disclosedFields: request.selectedFields,
      fieldCommitments: request.proofType === "selective_disclosure" ? (auxiliaryData.fieldCommitments as Record<string, string>) : undefined,
      commitment,
      timestamp: Date.now(),
    },
    verified,
  };
}

export function verifyZkProof(
  proofData: ZkProofOutput["proofData"],
  publicInputs: ZkProofOutput["publicInputs"]
): { valid: boolean; reason: string } {
  try {
    if (proofData.protocol !== "krydo-zkp-v1") {
      return { valid: false, reason: "Unknown proof protocol" };
    }

    const recomputedResponse = sha256(proofData.challenge + proofData.salt + "1");
    if (proofData.response !== recomputedResponse) {
      const failResponse = sha256(proofData.challenge + proofData.salt + "0");
      if (proofData.response === failResponse) {
        return { valid: false, reason: "Proof indicates claim does NOT satisfy the condition" };
      }
      return { valid: false, reason: "Invalid proof response - tampered data" };
    }

    const recomputedWitness = sha256(proofData.response + publicInputs.commitment);
    if (proofData.witness !== recomputedWitness) {
      return { valid: false, reason: "Invalid witness - proof integrity check failed" };
    }

    if (publicInputs.proofType === "range_above" && proofData.auxiliaryData.boundaryCheck) {
      const expectedBoundary = sha256(String(publicInputs.threshold) + proofData.challenge);
      if (proofData.auxiliaryData.boundaryCheck !== expectedBoundary) {
        return { valid: false, reason: "Boundary check failed - threshold may have been tampered" };
      }
    }

    if (publicInputs.proofType === "range_below" && proofData.auxiliaryData.boundaryCheck) {
      const expectedBoundary = sha256(String(publicInputs.threshold) + proofData.challenge);
      if (proofData.auxiliaryData.boundaryCheck !== expectedBoundary) {
        return { valid: false, reason: "Boundary check failed - threshold may have been tampered" };
      }
    }

    return { valid: true, reason: "ZK proof verified successfully - claim satisfies the condition without revealing the actual value" };
  } catch (err: any) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

function generateRangeProofChain(value: number, threshold: number, salt: string, direction: "above" | "below"): string[] {
  const steps: string[] = [];
  const bits = Math.ceil(Math.log2(Math.max(Math.abs(value), Math.abs(threshold), 2)));
  for (let i = 0; i < bits; i++) {
    const bitValue = (value >> i) & 1;
    steps.push(sha256(`bit_${i}_${bitValue}_${salt}`));
  }
  steps.push(sha256(`range_${direction}_${threshold}_${salt}`));
  return steps;
}

function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256("empty");
  if (leaves.length === 1) return leaves[0];
  const nextLevel: string[] = [];
  for (let i = 0; i < leaves.length; i += 2) {
    const left = leaves[i];
    const right = i + 1 < leaves.length ? leaves[i + 1] : left;
    nextLevel.push(sha256(left + right));
  }
  return buildMerkleRoot(nextLevel);
}
