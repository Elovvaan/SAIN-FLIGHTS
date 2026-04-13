export const RESERVE_THRESHOLD_PCT = 20;
export const CRITICAL_THRESHOLD_PCT = 10;
export const NOMINAL_PROPULSION_BUDGET_W = 800;
export const NOMINAL_FIELD_BUDGET_W = 200;
export const REDUCED_PROPULSION_BUDGET_W = 400;
export const REDUCED_FIELD_BUDGET_W = 50;

export function computeBudgets(batteryPct: number): {
  propulsionBudgetW: number;
  fieldBudgetW: number;
  reserveActive: boolean;
} {
  if (batteryPct <= CRITICAL_THRESHOLD_PCT) {
    return { propulsionBudgetW: REDUCED_PROPULSION_BUDGET_W, fieldBudgetW: 0, reserveActive: true };
  }
  if (batteryPct <= RESERVE_THRESHOLD_PCT) {
    return {
      propulsionBudgetW: REDUCED_PROPULSION_BUDGET_W,
      fieldBudgetW: REDUCED_FIELD_BUDGET_W,
      reserveActive: true,
    };
  }
  return {
    propulsionBudgetW: NOMINAL_PROPULSION_BUDGET_W,
    fieldBudgetW: NOMINAL_FIELD_BUDGET_W,
    reserveActive: false,
  };
}
