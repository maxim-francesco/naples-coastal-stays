import React, { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Session, User } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const isBrowser = typeof window !== "undefined";

const url = isBrowser ? (import.meta.env['VITE_SUPABASE_URL'] || "") : "";
const anonKey = isBrowser ? (import.meta.env['VITE_SUPABASE_ANON_KEY'] || "") : "";

// Instantiate client-side supabase client directly inside this file to comply with TanStack Start's SSR import protection
export const supabase = isBrowser
  ? createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (null as any);

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<any>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isBrowser || !supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then((res: any) => {
      const session = res.data?.session;
      if (active) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    }).catch((err: any) => {
      console.error("Error getting session:", err);
      if (active) {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: Session | null) => {
      if (active) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error("Supabase client is not initialized");
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signOut = async () => {
    if (!supabase) throw new Error("Supabase client is not initialized");
    return supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
