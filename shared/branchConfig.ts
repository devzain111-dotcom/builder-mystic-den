export const BRANCH_FIXED_VERIFICATION_AMOUNTS: Record<string, number> = {
  "BACOOR BRANCH": 75,
  "HARISSON BRANCH": 85,
  "NAKAR BRANCH": 75,
  "PARANAQUE AND AIRPORT": 75,
  "SAN AND HARRISON": 75,
  "CALANTAS BRANCH": 85,
  "UAE BRANCH": 3.3,
};

const NORMALIZED_FIXED_AMOUNTS = Object.fromEntries(
  Object.entries(BRANCH_FIXED_VERIFICATION_AMOUNTS).map(([name, amount]) => [
    name.trim().toUpperCase(),
    amount,
  ]),
);

export function getFixedVerificationAmount(
  branchName?: string | null,
): number | undefined {
  if (!branchName) return undefined;
  return NORMALIZED_FIXED_AMOUNTS[branchName.trim().toUpperCase()];
}

export function isFixedVerificationBranch(branchName?: string | null): boolean {
  return getFixedVerificationAmount(branchName) !== undefined;
}
