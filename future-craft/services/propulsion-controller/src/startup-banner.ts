/**
 * Startup verification banner for the propulsion-controller.
 *
 * Emits a structured log (pino) summarizing all field-mode and execution-layer
 * configuration so operators can verify the system state before arming.
 *
 * Every banner entry is tagged with `type: 'startup_verification'` so it can
 * be parsed by machine-readable log consumers as well as read by humans.
 *
 * Banner shows:
 *   - field mode enabled / disabled
 *   - stabilization enabled / disabled
 *   - translation enabled / disabled
 *   - output mode (mixer or passthrough)
 *   - output scale
 *   - resolved motor channel map
 *   - motor inversion flags
 *   - FC config status: VALID or INVALID for field-mode passthrough execution
 */

import type { Logger } from 'pino';
import type { ActuatorRouterConfig } from './actuator-router';
import { validatePassthroughConditions } from './actuator-router';

export type StartupContext = {
  fieldModeEnabled: boolean;
  stabilizationEnabled: boolean;
  /** Optional: future field-translator enable flag (defaults to false if absent). */
  translationEnabled?: boolean;
  hardwareMode: 'sim' | 'mavlink';
  routerConfig: ActuatorRouterConfig;
};

/**
 * Emit the startup verification banner to the provided pino logger at INFO
 * level.  All data is included in the structured log payload so automated
 * monitoring tools can parse it directly.
 */
export function emitStartupBanner(
  ctx: StartupContext,
  logger: Logger,
): void {
  const { outputMode, channelMap, inversionMap, outputScale } = ctx.routerConfig;

  const validation =
    outputMode === 'passthrough'
      ? validatePassthroughConditions(
          ctx.routerConfig,
          ctx.fieldModeEnabled,
          ctx.hardwareMode,
        )
      : { valid: true, errors: [] as string[], warnings: [] as string[] };

  const translationEnabled = ctx.translationEnabled ?? false;

  // Human-readable status line for the FC config check.
  let fcConfigStatus: string;
  if (outputMode === 'passthrough') {
    fcConfigStatus = validation.valid
      ? 'VALID — passthrough execution enabled'
      : 'INVALID — arming blocked until errors are resolved';
  } else {
    fcConfigStatus =
      'MIXER mode — FC applies its own mixer; NOT verified as true field-mode passthrough';
  }

  const bannerLines = [
    '╔═══════════════════════════════════════════════════════════╗',
    '║      PROPULSION CONTROLLER — STARTUP VERIFICATION         ║',
    '╚═══════════════════════════════════════════════════════════╝',
    `  Field mode         : ${ctx.fieldModeEnabled ? 'ENABLED' : 'disabled'}`,
    `  Stabilization      : ${ctx.stabilizationEnabled ? 'ENABLED' : 'disabled'}`,
    `  Translation        : ${translationEnabled ? 'ENABLED' : 'disabled'}`,
    `  Output mode        : ${outputMode.toUpperCase()}`,
    `  Output scale       : ${outputScale}`,
    `  Motor channel map  : A→ch${channelMap.A}  B→ch${channelMap.B}  C→ch${channelMap.C}  D→ch${channelMap.D}`,
    `  Motor inversions   : A=${inversionMap.A}  B=${inversionMap.B}  C=${inversionMap.C}  D=${inversionMap.D}`,
    `  FC config status   : ${fcConfigStatus}`,
    ...(validation.errors.length > 0
      ? validation.errors.map((e) => `  ⛔ ERROR: ${e}`)
      : []),
    ...(validation.warnings.length > 0
      ? validation.warnings.map((w) => `  ⚠  WARN: ${w}`)
      : []),
  ];

  logger.info(
    {
      type: 'startup_verification',
      fieldModeEnabled: ctx.fieldModeEnabled,
      stabilizationEnabled: ctx.stabilizationEnabled,
      translationEnabled,
      outputMode,
      outputScale,
      motorChannelMap: channelMap,
      motorInversionMap: inversionMap,
      fcConfigStatus,
      passthroughValid: validation.valid,
      passthroughErrors: validation.errors,
      passthroughWarnings: validation.warnings,
    },
    bannerLines.join('\n'),
  );
}
