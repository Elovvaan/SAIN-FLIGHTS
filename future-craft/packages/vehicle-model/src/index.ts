export interface LiftCell {
  id: 1 | 2 | 3 | 4;
  positionLabel: 'FORE_PORT' | 'FORE_STARBOARD' | 'AFT_PORT' | 'AFT_STARBOARD';
  maxThrustN: number;
  enclosed: true;
}

export interface ThrustCorridor {
  id: 'AFT_MAIN';
  maxThrustN: number;
  vectoringEnabled: boolean;
}

export interface VehicleSpec {
  id: string;
  name: string;
  maxMassKg: number;
  maxAltitudeM: number;
  liftCells: LiftCell[];
  thrustCorridor: ThrustCorridor;
}

export const VEHICLE_SPEC: VehicleSpec = {
  id: 'sain-001',
  name: 'Sain Flight Alpha',
  maxMassKg: 12,
  maxAltitudeM: 120,
  liftCells: [
    { id: 1, positionLabel: 'FORE_PORT', maxThrustN: 60, enclosed: true },
    { id: 2, positionLabel: 'FORE_STARBOARD', maxThrustN: 60, enclosed: true },
    { id: 3, positionLabel: 'AFT_PORT', maxThrustN: 60, enclosed: true },
    { id: 4, positionLabel: 'AFT_STARBOARD', maxThrustN: 60, enclosed: true },
  ],
  thrustCorridor: {
    id: 'AFT_MAIN',
    maxThrustN: 40,
    vectoringEnabled: false,
  },
};
