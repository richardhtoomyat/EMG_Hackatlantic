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
import Test from "./pages/Test";
import ChooseRole from "./pages/ChooseRole";
import AthleteDetail from "./pages/AthleteDetail";
import RequireRole from "./auth/RequireRole";

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/choose-role"
              element={
                <RequireAuth>
                  <ChooseRole />
                </RequireAuth>
              }
            />
            <Route
              path="/body-metrics"
              element={
                <RequireAuth>
                  <RequireRole>
                    <BodyMetrics />
                  </RequireRole>
                </RequireAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <RequireRole>
                    <RequireBodyMetrics>
                      <Layout />
                    </RequireBodyMetrics>
                  </RequireRole>
                </RequireAuth>
              }
            >
              <Route path="/" element={<Today />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/session" element={<Session />} />
              <Route path="/session/:id" element={<Session />} />
              <Route path="/history" element={<History />} />
              <Route path="/coach" element={<Coach />} />
              <Route path="/athlete/:id" element={<AthleteDetail />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/test" element={<Test />} />
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
