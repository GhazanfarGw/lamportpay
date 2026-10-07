/**
 * CSV for admin exports (pure). Cells are quoted per RFC 4180, and any cell that
 * a spreadsheet would read as a formula (=, +, -, @, tab, carriage return) is
 * prefixed with an apostrophe so an exported value can never execute.
 */
export type CsvValue = string | number | bigint | boolean | null | undefined;

export function safeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Plain numbers (including negative amounts) are safe and stay numeric.
  const numeric = typeof value === "number" || typeof value === "bigint";
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(header: readonly string[], rows: readonly CsvValue[][]): string {
  const lines = [header.map(safeCell).join(",")];
  for (const row of rows) lines.push(row.map(safeCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** UTC day bounds for "YYYY-MM-DD"; throws on anything else. */
export function utcDayBounds(day: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Use a date like 2026-10-07.");
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day) {
    throw new Error("Invalid date.");
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
