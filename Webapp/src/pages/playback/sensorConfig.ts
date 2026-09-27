import type { MuscleId } from "../../data/types";

export const SENSORS = ["MyoWareSensorL", "MyLocalWareSensorR"] as const;
export type SensorChannel = (typeof SENSORS)[number];
export type SensorPlacements = Record<SensorChannel, MuscleId | null>;

export const MUSCLE_PLACEMENTS: { id: MuscleId; label: string }[] = [
  { id: "f-traps-l", label: "Front left trapezius" },
  { id: "f-traps-r", label: "Front right trapezius" },
  { id: "f-delt-l", label: "Front left shoulder" },
  { id: "f-delt-r", label: "Front right shoulder" },
  { id: "f-pec-l", label: "Left chest" },
  { id: "f-pec-r", label: "Right chest" },
  { id: "f-bicep-l", label: "Left bicep" },
  { id: "f-bicep-r", label: "Right bicep" },
  { id: "f-forearm-l", label: "Front left forearm" },
  { id: "f-forearm-r", label: "Front right forearm" },
  { id: "f-abs", label: "Abdominals" },
  { id: "f-oblique-l", label: "Left oblique" },
  { id: "f-oblique-r", label: "Right oblique" },
  { id: "f-quad-l", label: "Left quadriceps" },
  { id: "f-quad-r", label: "Right quadriceps" },
  { id: "b-traps", label: "Back trapezius" },
  { id: "b-delt-l", label: "Back left shoulder" },
  { id: "b-delt-r", label: "Back right shoulder" },
  { id: "b-lat-l", label: "Left lat" },
  { id: "b-lat-r", label: "Right lat" },
  { id: "b-tricep-l", label: "Left tricep" },
  { id: "b-tricep-r", label: "Right tricep" },
  { id: "b-forearm-l", label: "Back left forearm" },
  { id: "b-forearm-r", label: "Back right forearm" },
  { id: "b-lowerback", label: "Lower back" },
  { id: "b-ham-l", label: "Left hamstring" },
  { id: "b-ham-r", label: "Right hamstring" },
  { id: "b-glute-l", label: "Left glute" },
  { id: "b-glute-r", label: "Right glute" },
  { id: "b-calf-l", label: "Left calf" },
  { id: "b-calf-r", label: "Right calf" },
];

export function placementLabel(id: MuscleId | null): string {
  return MUSCLE_PLACEMENTS.find((placement) => placement.id === id)?.label ?? "Disabled";
}
