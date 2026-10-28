/** How the ticket volume is entered: manual lots, or sized from a risk amount. */
export type UnitsMode = 'money' | 'equity' | 'units';

/** The risk-based sizing modes (everything except manual units). */
export type RiskUnitsMode = Exclude<UnitsMode, 'units'>;
