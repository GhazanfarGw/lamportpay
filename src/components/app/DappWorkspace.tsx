/**
 * Layout pieces for the conversion app (/pay): a wide workspace with the
 * journey rail on the left, the main converter in the centre and the cost
 * summary on the right (xl+). Below lg everything stacks: compact progress,
 * converter, summary. Phones get app-style pieces: pickers open as bottom
 * sheets and the primary action sits in a bar above the tab bar. Presentation only.
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";

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
    // Phones: room at the bottom for a docked action (MobileDock), when the page has one.
    <div className="max-w-[1440px] mx-auto px-4 lg:px-8 py-5 lg:py-8 max-sm:has-[[data-mobile-dock]]:pb-40">
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
    <div className="lg:rounded-3xl lg:border lg:border-border/60 lg:bg-card/70 lg:backdrop-blur-xl lg:p-5 lg:shadow-[var(--shadow-soft)] lg:space-y-5">
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
 * list. Keyboard and screen-reader friendly (Radix popover + cmdk list). On
 * phones the list opens as a bottom sheet instead of a small popover.
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
  const mobile = useIsMobile();
  const selected = options.find((o) => o.value === value) ?? null;
  const trigger = (
    <button
      type="button"
      aria-haspopup="listbox"
      data-state={open ? "open" : "closed"}
      onClick={mobile ? () => setOpen(true) : undefined}
      className={`group inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border/70 bg-background/90 pl-1.5 pr-3 py-1.5 text-sm font-semibold shadow-sm transition-all hover:border-primary/50 hover:shadow-[0_0_0_4px_oklch(0.52_0.22_275/0.08)] data-[state=open]:border-primary/60 data-[state=open]:shadow-[0_0_0_4px_oklch(0.52_0.22_275/0.12)] [-webkit-tap-highlight-color:transparent] active:scale-[0.97] ${triggerClassName}`}
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
  );
  const list = (
    <Command>
      {/* text-base on phones: iOS zooms the page into inputs smaller than 16px. */}
      <CommandInput placeholder={searchPlaceholder} className="h-11 text-base sm:text-sm" />
      <CommandList className={mobile ? "max-h-[55vh]" : "max-h-72"}>
        <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </CommandEmpty>
        <CommandGroup heading={mobile ? undefined : heading}>
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
              className={`flex items-center gap-3 rounded-xl px-3 cursor-pointer data-[disabled=true]:opacity-50 data-[disabled=true]:cursor-not-allowed ${mobile ? "py-3" : "py-2.5"}`}
            >
              {o.icon}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{o.label}</span>
                {o.sublabel && (
                  <span className="block text-xs text-muted-foreground truncate">{o.sublabel}</span>
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
  );

  if (mobile) {
    return (
      <>
        {trigger}
        <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
          <DrawerContent className="rounded-t-[28px] border-border/60 pb-[env(safe-area-inset-bottom)]">
            <DrawerTitle className="px-5 pt-3 pb-1 text-base font-semibold">
              {heading ?? searchPlaceholder}
            </DrawerTitle>
            <div className="px-2 pb-2">{list}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,340px)] p-0 rounded-2xl border-border/70 shadow-[var(--shadow-elegant)] overflow-hidden"
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}

/** Below Tailwind's `sm` (640px): where the bottom tab bar is shown. */
function useIsPhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = () => setPhone(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return phone;
}

/**
 * The page's primary action. On phones it is docked above the bottom tab bar,
 * in thumb reach while the page scrolls; from sm up it stays where it is
 * rendered. On phones it is portalled to <body>: the cards use backdrop-filter,
 * which would otherwise pin a fixed child to the card instead of the screen.
 * The children mount once either way. Show at most one dock per screen; a
 * submit button inside needs a `form` attribute, as it leaves its form.
 */
export function MobileDock({ children, className }: { children: ReactNode; className?: string }) {
  const phone = useIsPhone();
  if (!phone) return <div className={className}>{children}</div>;
  return (
    <>
      {/* Marker: DappWorkspace leaves room at the bottom for the dock. */}
      <span data-mobile-dock hidden />
      {createPortal(
        <div
          className={cn(
            "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border/60 bg-background/95 backdrop-blur-xl px-4 py-3 shadow-[0_-12px_30px_-18px_oklch(0.52_0.22_275/0.35)] print:hidden",
            className,
          )}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Phones: a section folded to one tappable row (title + a short summary) so
 * the step that needs the user stays near the top. From sm up it is always open.
 */
export function MobileCollapse({
  title,
  summary,
  children,
  enabled = true,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  /** False: always open, no fold row (e.g. once the section is what matters). */
  enabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!enabled) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="sm:hidden flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/90 px-4 py-3.5 text-left shadow-[var(--shadow-soft)] [-webkit-tap-highlight-color:transparent] active:scale-[0.99] transition-transform"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && (
            <span className="block truncate text-xs text-muted-foreground">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className={open ? undefined : "max-sm:hidden"}>{children}</div>
    </>
  );
}

/** Shimmering placeholder for values that are loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-block rounded-md bg-muted animate-pulse ${className}`} />
  );
}
