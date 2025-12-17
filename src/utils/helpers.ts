export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

export function formatPercent(num: number, decimals: number = 2): string {
  return `${(num * 100).toFixed(decimals)}%`;
}

export function formatUSD(num: number): string {
  return `$${num.toFixed(2)}`;
}

export function getCurrentTimestamp(): number {
  return Date.now();
}

export function timestampToDate(timestamp: number): Date {
  return new Date(timestamp);
}