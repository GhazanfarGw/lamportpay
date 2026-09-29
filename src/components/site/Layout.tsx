import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X, Twitter, Linkedin, Github, Mail } from "lucide-react";
import { useState, type ReactNode } from "react";
import { WalletButtonIsland } from "@/components/site/wallet/WalletIsland";
import logoAsset from "@/assets/lamportpay-logo.png.asset.json";

function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`relative block h-10 w-[160px] overflow-hidden ${className}`}>
      <img
        src={logoAsset.url}
        alt="LamportPay logo"
        className="absolute max-w-none"
        style={{ width: 270, left: -52, top: -69 }}
      />
    </span>
  );
}

const nav = [
  { to: "/pay", label: "Pay" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/workflow", label: "Workflow" },
  { to: "/whitepaper", label: "White paper" },
  { to: "/compliance", label: "Compliance" },
  { to: "/docs", label: "Docs" },
  { to: "/blog", label: "Blog" },
  { to: "/contact", label: "Contact" },
] as const;

export function SiteLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const showHeaderWallet = pathname !== "/swap";
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-lg bg-background/75 border-b border-border/60 print:hidden">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center group" aria-label="LamportPay home">
            <BrandLogo />
          </Link>
          <nav className="hidden lg:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md"
                activeProps={{
                  className: "px-3 py-2 text-sm text-foreground font-medium rounded-md",
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-2">
            {showHeaderWallet && <WalletButtonIsland />}
            <div className="flex items-center gap-1 mr-1">
              {socialLinks.map(({ label, href, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
            <Link
              to="/pay"
              className="px-4 py-2 text-sm font-medium rounded-full bg-foreground text-background hover:opacity-90 transition"
            >
              Send a payment
            </Link>
          </div>
          <button
            className="lg:hidden p-2 rounded-md hover:bg-muted"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {open && (
          <div className="lg:hidden border-t border-border bg-background">
            <div className="max-w-7xl mx-auto px-5 py-3 flex flex-col gap-1">
              {showHeaderWallet && (
                <div className="px-1 py-2">
                  <WalletButtonIsland />
                </div>
              )}
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="px-3 py-2 text-sm rounded-md hover:bg-muted"
                >
                  {n.label}
                </Link>
              ))}
              <Link
                to="/pay"
                onClick={() => setOpen(false)}
                className="mt-2 px-4 py-2 text-center text-sm font-medium rounded-full bg-foreground text-background"
              >
                Send a payment
              </Link>
              <div className="mt-3 flex items-center gap-2">
                {socialLinks.map(({ label, href, icon: Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 text-muted-foreground hover:text-foreground transition"
                  >
                    <Icon className="w-4 h-4" />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

const socialLinks = [
  { label: "X (Twitter)", href: "https://x.com/LamportPay", icon: Twitter },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/lamport-pay-31a564426/", icon: Linkedin },
  { label: "GitHub", href: "https://github.com/lamportpay", icon: Github },
] as const;

const contactEmail = "hello@lamportpay.com";

function SiteFooter() {
  return (
    <footer className="border-t border-border/60 mt-24 bg-secondary/40 print:hidden">
      <div className="max-w-7xl mx-auto px-5 py-12 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <BrandLogo className="mb-3" />
          <p className="text-sm text-muted-foreground max-w-sm">
            Crypto in. Local money out. A Solana-first crypto-to-local-currency payment routing
            demo.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {socialLinks.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 bg-card/70 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-secondary transition"
              >
                <Icon className="w-4 h-4" />
              </a>
            ))}
            <a
              href={`mailto:${contactEmail}`}
              aria-label={`Email ${contactEmail}`}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-border/60 bg-card/70 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-secondary transition"
            >
              <Mail className="w-4 h-4" />
            </a>
          </div>
          <a
            href={`mailto:${contactEmail}`}
            className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          >
            <Mail className="w-3.5 h-3.5" />
            {contactEmail}
          </a>
        </div>
        <div>
          <div className="text-sm font-semibold mb-3">Product</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/pay" className="hover:text-foreground">
                Send a payment
              </Link>
            </li>
            <li>
              <Link to="/how-it-works" className="hover:text-foreground">
                How it works
              </Link>
            </li>
            <li>
              <Link to="/workflow" className="hover:text-foreground">
                Workflow overview
              </Link>
            </li>
            <li>
              <Link to="/docs" className="hover:text-foreground">
                Developer docs
              </Link>
            </li>
            <li>
              <Link to="/blog" className="hover:text-foreground">
                Blog
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="text-sm font-semibold mb-3">Company</div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <Link to="/whitepaper" className="hover:text-foreground">
                White paper
              </Link>
            </li>
            <li>
              <Link to="/compliance" className="hover:text-foreground">
                Compliance
              </Link>
            </li>
            <li>
              <Link to="/contact" className="hover:text-foreground">
                Contact
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="max-w-7xl mx-auto px-5 py-5 space-y-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">Lamport Pay Ltd</span> — legal entity
            operating the <span className="font-medium text-foreground">LamportPay</span> platform.
            Contact:{" "}
            <a href={`mailto:${contactEmail}`} className="hover:text-foreground underline">
              {contactEmail}
            </a>
          </div>
          <div>
            Demo only. /swap may execute a small real Jupiter SOL-to-USDC swap back to the connected
            wallet. LamportPay does not process fiat payout, KYC, FX conversion, bank payout, or
            third-party recipient transfer.
          </div>
        </div>
      </div>
    </footer>
  );
}
