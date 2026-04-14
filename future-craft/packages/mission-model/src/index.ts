export type MissionPhase =
  | 'IDLE'
  | 'PREFLIGHT'
  | 'LAUNCH'
  | 'TRANSIT'
  | 'ON_STATION'
  | 'FIELD_OPERATION'
  | 'RTB'
  | 'COMPLETE';

export interface MissionObjective {
  id: string;
  phase: MissionPhase;
  description: string;
  requiredState: string;
}

export const DEFAULT_MISSION: MissionObjective[] = [
  { id: 'obj-1', phase: 'PREFLIGHT', description: 'Pass all system checks', requiredState: 'PREFLIGHT' },
  { id: 'obj-2', phase: 'LAUNCH', description: 'Arm and achieve stable hover', requiredState: 'HOVER_STABLE' },
  { id: 'obj-3', phase: 'ON_STATION', description: 'Follow target', requiredState: 'FOLLOW' },
  { id: 'obj-4', phase: 'FIELD_OPERATION', description: 'Execute field test', requiredState: 'HOVER_STABLE' },
  { id: 'obj-5', phase: 'RTB', description: 'Land safely', requiredState: 'LANDED' },
];
