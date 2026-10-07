/** Admin CSV export safety and the HTTP security headers. */
import { describe, expect, it } from "vitest";

import { safeCell, toCsv, utcDayBounds } from "@/lib/payments/csv";
import { SECURITY_HEADERS, withSecurityHeaders } from "@/lib/security-headers";

describe("CSV export", () => {
  it("quotes separators, quotes and new lines", () => {
    expect(safeCell('a,"b"')).toBe('"a,""b"""');
    expect(safeCell("line\nbreak")).toBe('"line\nbreak"');
    expect(safeCell(null)).toBe("");
  });

  it("neutralizes spreadsheet formulas but keeps numbers numeric", () => {
    expect(safeCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell(-5)).toBe("-5");
    expect(safeCell(10n)).toBe("10");
  });

  it("writes CRLF rows with a header", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("a,b\r\n1,x\r\n");
  });

  it("validates UTC days", () => {
    expect(utcDayBounds("2026-10-07")).toEqual({
      start: "2026-10-07T00:00:00.000Z",
      end: "2026-10-08T00:00:00.000Z",
    });
    expect(() => utcDayBounds("2026-02-30")).toThrow();
    expect(() => utcDayBounds("7/10/2026")).toThrow();
  });
});

describe("security headers", () => {
  it("adds every header without replacing existing ones", () => {
    const response = withSecurityHeaders(
      new Response("ok", { headers: { "X-Frame-Options": "SAMEORIGIN" } }),
    );
    for (const name of Object.keys(SECURITY_HEADERS)) expect(response.headers.has(name)).toBe(true);
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("copies an immutable response instead of failing", async () => {
    const original = Response.redirect("https://example.com/", 302);
    const response = withSecurityHeaders(original);
    expect(response.status).toBe(302);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("never blocks wallet popups", () => {
    expect(SECURITY_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });
});
