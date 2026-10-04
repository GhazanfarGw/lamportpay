import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/Layout";
import { useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  head: () =>
    pageSeo({
      path: "/contact",
      title: "Contact and Waitlist | LamportPay",
      description:
        "Request demo access, discuss a regulated payout partnership, ask about API access, or reach the LamportPay team at hello@lamportpay.com.",
    }),
  component: Contact,
});

function Contact() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    role: "User",
    interest: "Early access",
    message: "",
  });
  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });

  return (
    <SiteLayout>
      <section className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">
          Contact / waitlist
        </div>
        <h1 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
          Get early access to LamportPay.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Tell us who you are and how you'd like to use LamportPay.
        </p>
        <a
          href="mailto:hello@lamportpay.com"
          className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <Mail className="w-4 h-4" />
          hello@lamportpay.com
        </a>

        {sent ? (
          <div className="mt-12 rounded-3xl border border-border/60 bg-card p-10 text-center shadow-[var(--shadow-soft)]">
            <div className="w-14 h-14 rounded-full bg-[color:var(--success)]/15 text-[color:var(--success)] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">Thanks.</h2>
            <p className="mt-2 text-muted-foreground">
              Your LamportPay request has been saved for demo purposes.
            </p>
            <button
              onClick={() => {
                setSent(false);
                setForm({
                  name: "",
                  email: "",
                  company: "",
                  role: "User",
                  interest: "Early access",
                  message: "",
                });
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 font-semibold hover:opacity-90 transition"
            >
              Submit another
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
            className="mt-12 rounded-3xl border border-border/60 bg-card p-6 md:p-10 shadow-[var(--shadow-soft)] space-y-5"
          >
            <div className="grid md:grid-cols-2 gap-5">
              <Field label="Name">
                <input
                  required
                  value={form.name}
                  onChange={set("name")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                />
              </Field>
              <Field label="Email">
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                />
              </Field>
              <Field label="Company">
                <input
                  value={form.company}
                  onChange={set("company")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                />
              </Field>
              <Field label="Role">
                <select
                  value={form.role}
                  onChange={set("role")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  {["User", "Developer", "Investor", "Payout Partner", "Other"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              <Field label="Interest">
                <select
                  value={form.interest}
                  onChange={set("interest")}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  {["Early access", "Partnership", "API access", "Investment", "Other"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Message">
              <textarea
                rows={5}
                value={form.message}
                onChange={set("message")}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5"
              />
            </Field>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-[image:var(--gradient-hero)] text-white px-6 py-3 font-semibold shadow-[var(--shadow-soft)] hover:opacity-95 transition"
            >
              Request access
            </button>
            <p className="text-xs text-muted-foreground">
              Mock submission only. No data is stored.
            </p>
          </form>
        )}
      </section>
    </SiteLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
