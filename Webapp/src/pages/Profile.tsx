import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";

import { useAppData } from "../data/dataContext";
import { supabase } from "../lib/supabase";

export default function Profile() {
  const { ATHLETE } = useAppData();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  // Get identity information from the authenticated account
  const fullName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    ATHLETE.name;

  const email = user?.email || ATHLETE.email;

  const avatar =
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    null;

  const handleLogout = async () => {
    if (!supabase) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout failed:", error.message);
    }
  };

  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Profile</h2>

      <div className="bg-surface rounded-2xl p-5 text-center mt-3">
        {avatar ? (
          <img
            src={avatar}
            alt={fullName}
            className="w-[60px] h-[60px] rounded-full object-cover mx-auto mb-3"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="rounded-full bg-track mx-auto mb-3"
            style={{ width: 60, height: 60 }}
          />
        )}

        <div className="text-lg font-medium">{fullName}</div>
        <div className="text-[13px] text-muted">{email}</div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">
        Body Metrics
      </h3>

      <div className="bg-surface rounded-2xl p-3.5 flex flex-col gap-3">
        <Row label="Height" value={ATHLETE.heightLabel} />
        <Row label="Weight" value={ATHLETE.weightLabel} />
        <Row label="Age" value={String(ATHLETE.age)} />
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">
        Connected Devices
      </h3>

      <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center">
        <div>
          <div className="font-medium">MyoWare Sensors</div>
          <div className="text-xs text-muted">
            2x sensors · Bluetooth
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-deep text-xs">
          <span className="w-2 h-2 rounded-full bg-accent" />
          {ATHLETE.sensorsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <Link
        to="/coach"
        className="flex items-center justify-center h-12 rounded-full border border-line mt-5"
      >
        Share with Coach
      </Link>

      <button
        onClick={handleLogout}
        className="flex items-center justify-center h-12 rounded-full bg-max text-white mt-2 font-semibold"
      >
        Logout
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}