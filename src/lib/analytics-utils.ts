export function getAnalyticsRange(range: string | null) {
  const now = new Date();
  let cutoff = new Date();
  let truncUnit = 'month';
  let format = 'Mon YY';
  let label = 'month';

  switch (range) {
    case 'day':
      // Last 24 hours
      cutoff.setHours(now.getHours() - 23, 0, 0, 0);
      truncUnit = 'hour';
      format = 'HH24:00';
      label = 'hour';
      break;
    case 'week':
      // Last 7 days
      cutoff.setDate(now.getDate() - 6);
      cutoff.setHours(0, 0, 0, 0);
      truncUnit = 'day';
      format = 'Dy DD';
      label = 'day';
      break;
    case 'year':
      // Last 12 months
      cutoff.setMonth(now.getMonth() - 11);
      cutoff.setDate(1);
      cutoff.setHours(0, 0, 0, 0);
      truncUnit = 'month';
      format = 'Mon YY';
      label = 'month';
      break;
    case 'month':
    default:
      // Last 30 days
      cutoff.setDate(now.getDate() - 29);
      cutoff.setHours(0, 0, 0, 0);
      truncUnit = 'day';
      format = 'DD Mon';
      label = 'day';
      break;
  }

  return { cutoff, truncUnit, format, label };
}

export function getAnalyticsDateRange(from: string | null | undefined, to: string | null | undefined) {
  const now = new Date();
  
  // Default fromDate to 30 days ago
  const defaultFrom = new Date();
  defaultFrom.setDate(defaultFrom.getDate() - 29);
  defaultFrom.setHours(0, 0, 0, 0);

  const fromDate = from ? new Date(from) : defaultFrom;
  fromDate.setHours(0, 0, 0, 0);

  const toDate = to ? new Date(to) : now;
  toDate.setHours(23, 59, 59, 999);

  // Calculate difference in days
  const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let truncUnit = 'month';
  let format = 'Mon YY';

  if (diffDays <= 1) {
    truncUnit = 'hour';
    format = 'HH24:00';
  } else if (diffDays <= 31) {
    truncUnit = 'day';
    format = 'DD Mon';
  } else {
    truncUnit = 'month';
    format = 'Mon YY';
  }

  return { fromDate, toDate, truncUnit, format };
}
