/**
 * LamportPay Admin application shell: a persistent left sidebar (a drawer on
 * mobile), a top bar with the signed-in admin and sign-out, and a content
 * area. Apart from the logo it shares nothing with the marketing site's header
 * or footer, so admin reads as its own product.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  Coins,
  LayoutDashboard,
  LogOut,
  Menu,
  ReceiptText,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BrandLogo } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

type NavItem = { to: string; label: string; icon: LucideIcon };

const ADMIN_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Operations",
    items: [
      { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/admin/payments", label: "Payments", icon: ReceiptText },
      { to: "/admin/users", label: "Users & roles", icon: Users },
    ],
  },
  {
    section: "Revenue",
    items: [
      { to: "/admin/fees-revenue", label: "Fees & Revenue", icon: Coins },
      { to: "/admin/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    section: "System",
    items: [
      { to: "/admin/audit-logs", label: "Audit logs", icon: ScrollText },
      { to: "/admin/system-status", label: "System status", icon: Activity },
      { to: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

function Brand() {
  return (
    <Link
      to="/admin/dashboard"
      aria-label="LamportPay Admin dashboard"
      className="flex items-center gap-2 px-2"
    >
      <BrandLogo className="h-7" />
      <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-background">
        Admin
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6" aria-label="Admin">
      {ADMIN_NAV.map((group) => (
        <div key={group.section} className="space-y-1">
          <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.section}
          </div>
          {group.items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition"
              activeProps={{
                className:
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm bg-muted text-foreground font-medium",
              }}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/admin/login", search: { next: "/admin" }, replace: true });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };
  return { busy, signOut };
}

export function AdminShell({
  email,
  environment,
  children,
}: {
  email: string | null;
  /** "sandbox" / "production" badge in the top bar, when known. */
  environment?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { busy, signOut } = useSignOut();

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-border/60 bg-background">
        <div className="h-16 flex items-center border-b border-border/60 px-3">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav />
        </div>
        <div className="border-t border-border/60 p-3 text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            View public site
          </Link>
        </div>
      </aside>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <div className="h-16 flex items-center border-b border-border/60 px-3">
            <Brand />
          </div>
          <div className="px-3 py-5">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 h-16 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 backdrop-blur px-4 md:px-6">
          <div className="flex items-center gap-2">
            <button
              className="lg:hidden p-2 rounded-md hover:bg-muted"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link
              to="/admin/dashboard"
              aria-label="LamportPay Admin dashboard"
              className="lg:hidden shrink-0"
            >
              <BrandLogo className="h-7" />
            </Link>
            {environment && (
              <span
                className={`hidden sm:inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  environment === "production"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                Stables {environment}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[220px]">
                {email}
              </span>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void signOut()}>
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sign out
            </Button>
          </div>
        </header>
        <main className="px-4 md:px-6 py-6 max-w-6xl">{children}</main>
      </div>
    </div>
  );
}

/** Page frame: breadcrumb, title, optional description and actions. */
export function AdminPage({
  title,
  description,
  actions,
  crumbs = [],
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground flex gap-1.5">
          <Link to="/admin/dashboard" className="hover:text-foreground">
            Admin
          </Link>
          {crumbs.map((c) => (
            <span key={c.label} className="flex gap-1.5">
              <span>/</span>
              {c.to ? (
                <Link to={c.to} className="hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span className="text-foreground">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
            )}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** A white card section with an optional heading. */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-background p-5 space-y-4">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-6 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
      {error instanceof Error ? error.message : "Something went wrong."}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

/**
 * A button that asks for confirmation before a dangerous or irreversible
 * admin action (revoking a role, changing the revenue wallet, …).
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  disabled,
  children,
  variant = "outline",
  size = "sm",
  "aria-label": ariaLabel,
}: {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: "outline" | "ghost" | "default" | "destructive";
  size?: "sm" | "default";
  "aria-label"?: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled} aria-label={ariaLabel}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
