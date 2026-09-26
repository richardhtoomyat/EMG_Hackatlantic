import { useEffect, useState } from "react";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { HashRouter, Route, Routes } from "react-router-dom";

import Layout from "./components/Layout";
import { DataProvider } from "./data/DataProvider";
import { supabase } from "./lib/supabase";

import Auth from "./pages/Auth";
import Today from "./pages/Today";
import Workout from "./pages/Workout";
import Session from "./pages/Session";
import History from "./pages/History";
import Coach from "./pages/Coach";
import Profile from "./pages/Profile";

export default function App() {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check if the user is already logged in
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Listen for login/logout changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Show loading screen while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        Loading...
      </div>
    );
  }

  // Supabase environment variables are missing
  if (!supabase) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        Supabase is not configured.
      </div>
    );
  }

  // User is not logged in
  if (!session) {
    return <Auth />;
  }

  // User is logged in — show existing ActivateMIO app
  return (
    <DataProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Today />} />
            <Route path="/workout" element={<Workout />} />
            <Route path="/session" element={<Session />} />
            <Route path="/history" element={<History />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Routes>
      </HashRouter>
    </DataProvider>
  );
}