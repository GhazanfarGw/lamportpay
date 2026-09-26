import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export function AdminSignOutButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", search: { next: "/admin" }, replace: true });
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleSignOut()}>
      <LogOut className="w-3.5 h-3.5 mr-2" />
      Sign out
    </Button>
  );
}
