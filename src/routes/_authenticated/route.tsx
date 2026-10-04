import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { isAdminPath } from "@/lib/admin-path";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // Admin pages have their own sign-in page, separate from the customer one.
      if (isAdminPath(location.pathname)) {
        throw redirect({ to: "/admin/login", search: { next: location.href } });
      }
      throw redirect({ to: "/auth", search: { next: location.href } });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
