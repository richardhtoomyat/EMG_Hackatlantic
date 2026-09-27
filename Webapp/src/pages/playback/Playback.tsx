import { Link } from "react-router-dom";
import PassiveBaselineRecorder from "./PassiveBaselineRecorder";
import StrainRecorder from "./StrainRecorder";

export default function Playback() {
  return (
    <div className="flex-grow flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-serif font-light text-[27px] leading-tight">Recording playback</h1>
        <Link to="/" className="text-sm text-accent">Back</Link>
      </div>
      <p className="text-sm text-muted mb-3">Record a baseline or capture and replay muscle strain.</p>
      <PassiveBaselineRecorder />
      <StrainRecorder />
    </div>
  );
}
