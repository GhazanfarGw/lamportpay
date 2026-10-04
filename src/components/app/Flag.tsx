/**
 * National flags for the payout-country picker: the real flag artwork, served
 * from /public/flags (copied from country-flag-icons, MIT — see
 * public/flags/LICENSE.txt). Image files, not emoji, so they render the same on
 * Windows; nothing is loaded from a third party. A country without a file shows
 * its ISO code.
 *
 * To add a country: copy its 3x2 SVG from country-flag-icons into public/flags
 * and add the code below.
 */
import { useState } from "react";

/** Countries with a flag file in /public/flags (the Stables payout list + PK). */
const FLAGS = new Set("AR AU BR CI CM CN CO GB GH IN KE MX NG PH PK RW TZ UG US ZA ZM".split(" "));

export function Flag({ code, size = 22 }: { code: string; size?: number }) {
  const key = code.toUpperCase();
  const [failed, setFailed] = useState(false);
  const height = Math.round((size * 2) / 3);
  if (FLAGS.has(key) && !failed) {
    return (
      <img
        src={`/flags/${key}.svg`}
        alt=""
        aria-hidden
        width={size}
        height={height}
        decoding="async"
        draggable={false}
        className="shrink-0 rounded-[4px] object-cover ring-1 ring-black/10"
        style={{ width: size, height }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-grid place-items-center rounded-[4px] bg-muted text-[9px] font-bold text-muted-foreground shrink-0"
      style={{ width: size, height }}
    >
      {key}
    </span>
  );
}
