import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider } from "./auth/AuthProvider";
import RequireAuth from "./auth/RequireAuth";
import { DataProvider } from "./data/DataProvider";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Workout from "./pages/Workout";
import Session from "./pages/Session";
import History from "./pages/History";
import Coach from "./pages/Coach";
import Profile from "./pages/Profile";

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
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
    </AuthProvider>
  );
}
