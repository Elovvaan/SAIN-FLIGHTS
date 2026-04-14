export interface FlightControllerLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  arm(): Promise<void>;
  disarm(): Promise<void>;
  setThrottle(liftCells: [number, number, number, number], thrustPct: number): Promise<void>;
  getHealth(): Promise<{ healthy: boolean; cells: boolean[] }>;
}

export interface PowerRouterLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readEnergyState(): Promise<{
    batteryPct: number;
    voltageMv: number;
    currentMa: number;
    estimatedRemainingMs: number;
  }>;
  setPropulsionBudgetW(watts: number): Promise<void>;
  setFieldBudgetW(watts: number): Promise<void>;
}

export interface FieldDriverLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  activateZone(zoneId: string, intensityPct: number, durationMs?: number): Promise<void>;
  deactivateZone(zoneId: string): Promise<void>;
  getZoneHealth(zoneId: string): Promise<{ healthy: boolean }>;
}

export interface CameraLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  captureFrame(): Promise<Buffer>;
  getStreamUrl(): string;
}

export interface AudioLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  speak(text: string): Promise<void>;
  listenOnce(timeoutMs: number): Promise<string | null>;
}

export interface SensorLink {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readAltitudeM(): Promise<number>;
  readImu(): Promise<{ roll: number; pitch: number; yaw: number }>;
  readGps(): Promise<{ lat: number; lon: number; altM: number } | null>;
}
