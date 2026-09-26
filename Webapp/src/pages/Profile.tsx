import { Link } from "react-router-dom";
import { ATHLETE } from "../data/mockData";

export default function Profile() {
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Profile</h2>

      <div className="bg-surface rounded-2xl p-5 text-center mt-3">
        <div className="w-15 h-15 rounded-full bg-track mx-auto mb-3" style={{ width: 60, height: 60 }} />
        <div className="text-lg font-medium">{ATHLETE.name}</div>
        <div className="text-[13px] text-muted">{ATHLETE.email}</div>
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Body Metrics</h3>
      <div className="bg-surface rounded-2xl p-3.5 flex flex-col gap-3">
        <Row label="Height" value={ATHLETE.heightLabel} />
        <Row label="Weight" value={ATHLETE.weightLabel} />
        <Row label="Age" value={String(ATHLETE.age)} />
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Connected Devices</h3>
      <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center">
        <div>
          <div className="font-medium">MyoWare Sensors</div>
          <div className="text-xs text-muted">2x sensors · Bluetooth</div>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-deep text-xs">
          <span className="w-2 h-2 rounded-full bg-accent" />
          {ATHLETE.sensorsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <Link to="/coach" className="flex items-center justify-center h-12 rounded-full border border-line mt-5">
        Share with Coach
      </Link>
      <button className="flex items-center justify-center h-12 rounded-full bg-max text-white mt-2 font-semibold">
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
