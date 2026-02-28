export type BranchRuleLike = {
  id?: string;
  pattern: string;
  requirePr: boolean;
  requireCodeOwners?: boolean;
  requireApprovals: number;
  blockDirectPush: boolean;
  updatedAt?: Date;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function branchPatternMatches(pattern: string, branchName: string): boolean {
  const normalizedPattern = pattern.trim();
  const normalizedBranch = branchName.trim();
  if (!normalizedPattern || !normalizedBranch) {
    return false;
  }

  if (normalizedPattern === normalizedBranch) {
    return true;
  }

  const regex = new RegExp(
    `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`,
  );
  return regex.test(normalizedBranch);
}

function branchRuleScore(rule: BranchRuleLike): number {
  const pattern = rule.pattern.trim();
  const wildcardCount = (pattern.match(/\*/g) ?? []).length;
  const literalLength = pattern.replace(/\*/g, '').length;
  const exactBonus = wildcardCount === 0 ? 1000 : 0;
  return exactBonus + literalLength * 10 - wildcardCount;
}

export function selectBranchRule(
  rules: BranchRuleLike[],
  branchName: string,
): BranchRuleLike | null {
  const matching = rules.filter((rule) =>
    branchPatternMatches(rule.pattern, branchName),
  );

  if (!matching.length) {
    return null;
  }

  return matching.sort((left, right) => {
    const scoreDiff = branchRuleScore(right) - branchRuleScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const leftUpdated = left.updatedAt?.getTime() ?? 0;
    const rightUpdated = right.updatedAt?.getTime() ?? 0;
    return rightUpdated - leftUpdated;
  })[0];
}
