"use client";

import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

// Pushes the authenticated identity into our membership context and wires
// the real sign-out.
export function SessionBridge() {
  const { syncIdentity, bindSignOut } = useAuth();

  useEffect(() => {
    const sb = browserSupabase();

    bindSignOut(() => {
      void sb.auth.signOut();
    });

    const apply = (session: Session | null) => {
      const u = session?.user;
      if (u && u.email) {
        const meta = (u.user_metadata ?? {}) as { name?: string };
        syncIdentity({
          email: u.email,
          name: meta.name || u.email.split("@")[0] || "用户",
        });
      } else {
        syncIdentity(null);
      }
    };

    void sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      apply(session)
    );

    return () => {
      sub.subscription.unsubscribe();
      bindSignOut(null);
    };
  }, [syncIdentity, bindSignOut]);

  return null;
}
