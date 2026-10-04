/**
 * Layout pieces for the conversion app (/pay): a wide workspace with the
 * journey rail on the left, the main converter in the centre and the cost
 * summary on the right (xl+). Below lg everything stacks: compact progress,
 * converter, summary. Presentation only.
 */
import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function DappWorkspace({
  rail,
  main,
  aside,
}: {
  rail: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="max-w-[1440px] mx-auto px-4 lg:px-8 py-5 lg:py-8">
      <div className="grid gap-5 lg:gap-6 lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_minmax(340px,400px)]">
        {/* Both side panels stay in view while the centre scrolls (sticky below the
            64px header). A panel taller than the window scrolls on its own. */}
        <aside className="lg:sticky lg:top-20 self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:none]">
          {rail}
        </aside>
        <section className="min-w-0 space-y-5">{main}</section>
        {aside && (
          <aside className="min-w-0 lg:col-start-2 xl:col-start-auto xl:sticky xl:top-20 self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:overscroll-contain [scrollbar-width:none] space-y-4">
            {aside}
          </aside>
        )}
      </div>
    </div>
  );
}

/** The rail's frame: title, the stepper, and an optional footer. */
export function RailCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="lg:rounded-3xl lg:border lg:border-border/60 lg:bg-card/70 lg:backdrop-blur-xl lg:p-5 lg:shadow-[var(--shadow-soft)] space-y-5">
      <div className="hidden lg:block">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Your conversion
        </div>
        <div className="h-0.5 w-10 mt-2 rounded-full bg-[image:var(--gradient-uv)]" />
      </div>
      {children}
      {footer && <div className="hidden lg:block border-t border-border/60 pt-4">{footer}</div>}
    </div>
  );
}

/** A card with a soft brand-gradient edge and glow, for the primary surfaces. */
export function GlowCard({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`relative rounded-[28px] p-px bg-[linear-gradient(135deg,oklch(0.62_0.28_295/0.55),oklch(0.82_0.18_200/0.35)_45%,oklch(0.929_0.013_255.508/0.9)_70%)] ${
        glow
          ? "shadow-[0_30px_80px_-30px_oklch(0.52_0.22_275/0.45)]"
          : "shadow-[var(--shadow-soft)]"
      } ${className}`}
    >
      <div className="rounded-[27px] bg-card/95 backdrop-blur-xl h-full">{children}</div>
    </div>
  );
}

export type PickerOption = {
  value: string;
  label: string;
  sublabel?: string;
  icon: ReactNode;
  right?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
};

/**
 * DEX-style selector: a pill trigger (icon + symbol) that opens a searchable
 * list. Keyboard and screen-reader friendly (Radix popover + cmdk list).
 */
export function Picker({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  heading,
  triggerClassName = "",
  footer,
}: {
  value: string | null;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder: ReactNode;
  searchPlaceholder: string;
  emptyText: string;
  heading?: string;
  triggerClassName?: string;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          className={`group inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/90 pl-1.5 pr-3 py-1.5 text-sm font-semibold shadow-sm transition-all hover:border-primary/50 hover:shadow-[0_0_0_4px_oklch(0.52_0.22_275/0.08)] data-[state=open]:border-primary/60 data-[state=open]:shadow-[0_0_0_4px_oklch(0.52_0.22_275/0.12)] ${triggerClassName}`}
        >
          {selected ? (
            <>
              {selected.icon}
              <span className="truncate">{selected.label}</span>
            </>
          ) : (
            <span className="pl-2 text-muted-foreground font-medium">{placeholder}</span>
          )}
          <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,340px)] p-0 rounded-2xl border-border/70 shadow-[var(--shadow-elegant)] overflow-hidden"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-11" />
          <CommandList className="max-h-72">
            <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </CommandEmpty>
            <CommandGroup heading={heading}>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.sublabel ?? ""} ${(o.keywords ?? []).join(" ")}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed"
                >
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{o.label}</span>
                    {o.sublabel && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {o.sublabel}
                      </span>
                    )}
                  </span>
                  {o.right}
                  {o.value === value && <Check className="w-4 h-4 text-primary" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer && (
            <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
              {footer}
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Shimmering placeholder for values that are loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-block rounded-md bg-muted animate-pulse ${className}`} />
  );
}
