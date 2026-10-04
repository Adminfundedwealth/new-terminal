import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_CONFIGURED } from "@/integrations/supabase/client";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const queryClient = useQueryClient();
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let mounted = true;
        const finalizeSession = (nextSession) => {
            if (!mounted)
                return;
            setSession(nextSession);
            setLoading(false);
        };
        void supabase.auth.getSession().then(({ data, error }) => {
            if (!mounted)
                return;
            if (error) {
                console.error("Supabase session initialization failed:", error.message);
            }
            finalizeSession(data.session ?? null);
        });
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!mounted)
                return;
            setSession(nextSession ?? null);
            if (!nextSession) {
                void queryClient.removeQueries({ predicate: (query) => query.queryKey[0] === "customer-account" || query.queryKey[0] === "terminal-os" });
            }
            setLoading(false);
        });
        return () => {
            mounted = false;
            listener.subscription.unsubscribe();
        };
    }, [queryClient]);
    const value = {
        session,
        user: session?.user ?? null,
        loading,
        configured: SUPABASE_CONFIGURED,
        signIn: async (email, password) => {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error)
                throw error;
        },
        signUp: async (email, password) => {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error)
                throw error;
        },
        signOut: async () => {
            const { error } = await supabase.auth.signOut();
            if (error)
                throw error;
        },
    };
    return _jsx(AuthContext.Provider, { value: value, children: children });
}
export function useAuth() {
    const value = useContext(AuthContext);
    if (!value)
        throw new Error("useAuth must be used inside AuthProvider");
    return value;
}
