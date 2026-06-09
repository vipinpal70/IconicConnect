export const CATEGORY_PREFIXES: Record<string, string> = {
  "Crown & Bridges": "CAB",
  "Denture": "CDT",
  "Cosmetics": "CCA",
  "Appliances": "CAP",
  "Implant": "CAI"
};

export function getCasePrefix(category: string): string {
  return CATEGORY_PREFIXES[category] || category
    .split(/[\s&]+/)
    .map(word => word[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
}

export function formatCaseNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export function generateCaseId(category: string): string {
  return getCasePrefix(category);
}

export const HOLD_REASONS = [
  "Scan has artifacts",
  "Scan is not good",
  "Bite is not Aligned",
  "Margin is not good",
  "Order set-up seems Wrong",
  "No space to design crown/implant",
  "Implant Kit not found",
  "Scans missing",
  "Other (please specify)"
] as const;
