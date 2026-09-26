import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Google Sign In
  const handleGoogleSignIn = async () => {
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
  };

  // Email + Password Sign In
  const handleSignIn = async () => {
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    if (!email || !password) {
      setMessage("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    }

    setLoading(false);
  };

  // Email + Password Sign Up
  const handleSignUp = async () => {
    if (!supabase) {
      setMessage("Supabase is not configured.");
      return;
    }

    if (!email || !password) {
      setMessage("Please enter your email and password.");
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        "Account created! Check your email to confirm your account."
      );
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-slate-900 rounded-2xl shadow-xl p-8">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">
            ActivateMIO
          </h1>

          <p className="text-slate-400 mt-2">
            Sign in to continue
          </p>
        </div>

        {/* Google */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-white text-slate-900 font-medium py-3 px-4 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
        >
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="h-px bg-slate-700 flex-1" />

          <span className="text-slate-500 text-sm">
            OR
          </span>

          <div className="h-px bg-slate-700 flex-1" />
        </div>

        {/* Email */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Email
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              Password
            </label>

            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-3 outline-none focus:border-blue-500"
            />
          </div>

          {/* Sign In */}
          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-blue-500 transition disabled:opacity-50"
          >
            {loading ? "Please wait..." : "Sign In"}
          </button>

          {/* Sign Up */}
          <button
            type="button"
            onClick={handleSignUp}
            disabled={loading}
            className="w-full border border-slate-700 text-white font-medium py-3 px-4 rounded-lg hover:bg-slate-800 transition disabled:opacity-50"
          >
            Create Account
          </button>
        </div>

        {/* Error / Success Message */}
        {message && (
          <div className="mt-5 bg-slate-800 rounded-lg p-3">
            <p className="text-sm text-center text-slate-300">
              {message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}