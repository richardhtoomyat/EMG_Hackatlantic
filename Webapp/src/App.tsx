import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/authContext";
import Layout from "./components/Layout";
import { AuthProvider } from "./auth/AuthProvider";
import RequireAuth from "./auth/RequireAuth";
import RequireBodyMetrics from "./auth/RequireBodyMetrics";
import { DataProvider } from "./data/DataProvider";
import Login from "./pages/Login";
import BodyMetrics from "./pages/BodyMetrics";
import Today from "./pages/Today";
import Workout from "./pages/Workout";
import Session from "./pages/Session";
import History from "./pages/History";
import Coach from "./pages/Coach";
import Profile from "./pages/Profile";
import Playback from "./pages/playback/Playback";

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/body-metrics"
              element={
                <RequireAuth>
                  <BodyMetrics />
                </RequireAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <RequireBodyMetrics>
                    <Layout />
                  </RequireBodyMetrics>
                </RequireAuth>
              }
            >
              <Route path="/" element={<Today />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/session" element={<Session />} />
              <Route path="/history" element={<History />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/playback" element={<Playback />} />
            </Route>
            {/* e.g. "#access_token=…" while supabase-js finishes a Google / email-link sign-in */}
            <Route path="*" element={<AuthRedirect />} />
          </Routes>
        </HashRouter>
      </DataProvider>
    </AuthProvider>
  );
}

/** Unknown route: wait for auth to settle, then go home (RequireAuth sends signed-out users to /login). */
function AuthRedirect() {
  const { loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted text-sm">Signing in…</div>;
  }
  return <Navigate to="/" replace />;
}
