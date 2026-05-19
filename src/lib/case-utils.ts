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
    // Browser fallback: Use Date.now() and take last 10 digits
    const msStr = Date.now().toString();
    suffix = msStr.slice(-10).padStart(10, '0');
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
