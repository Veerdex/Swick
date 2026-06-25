import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface AuthInfo {
  /** False until the first session check resolves. */
  ready: boolean;
  /** True for a guest (anonymous) session — the casual-only state. */
  isGuest: boolean;
  /** The linked account's email, once upgraded. */
  email: string | null;
}

/** Tracks whether the player is a guest or a linked account, live. */
export function useAuth(): AuthInfo {
  const [info, setInfo] = useState<AuthInfo>({
    ready: false,
    isGuest: true,
    email: null,
  });

  useEffect(() => {
    const apply = (session: Session | null) =>
      setInfo({
        ready: true,
        isGuest: session?.user?.is_anonymous ?? true,
        email: session?.user?.email ?? null,
      });

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  return info;
}
