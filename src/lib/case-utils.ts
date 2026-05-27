const CATEGORY_PREFIXES: Record<string, string> = {
  "Crown & Bridges": "CAB",
  "Denture": "CDT",
  "Cosmetics": "CCA",
  "Appliances": "CAP",
  "Implant": "CAI"
};

export function generateCaseId(category: string): string {
  const prefix = CATEGORY_PREFIXES[category] || getFallbackPrefix(category);

  let suffix = '';
  if (typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint) {
    const nsStr = process.hrtime.bigint().toString();
    suffix = nsStr.slice(-10).padStart(10, '0');
  } else {
    // Browser fallback: Use Date.now() and append random digits to ensure absolute uniqueness
    const msStr = Date.now().toString();
    const rand = Math.floor(100000 + Math.random() * 900000).toString(); // 6 random digits
    suffix = (msStr.slice(-4) + rand).padStart(10, '0');
  }

  return `${prefix}-${suffix}`;
}

function getFallbackPrefix(category: string): string {
  return category
    .split(/[\s&]+/) // Split by space or &
    .map(word => word[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X'); // Pad with X if less than 3 chars
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
