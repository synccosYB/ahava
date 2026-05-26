export type PtoExplanationInput = {
  accrualType?: string | null;
  accrualHoursPerYear?: number | null;
  vacationAccrualPerHoursWorked?: number | null;
  vacationAccrualHoursPerThreshold?: number | null;
  yearlyCapHours?: number | null;
  carryoverCapHours?: number | null;
};

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString();
}

function hourWord(n: number | null | undefined): string {
  return n === 1 ? "hour" : "hours";
}

export function explainPtoPolicy(input: PtoExplanationInput): string {
  const type = input.accrualType ?? "annual";
  const cap = input.yearlyCapHours;
  const carryover = input.carryoverCapHours ?? 0;
  const carryoverSentence = carryover > 0
    ? `Up to ${fmt(carryover)} unused ${hourWord(carryover)} carry over to next year.`
    : "Unused PTO resets on Jan 1.";

  if (type === "per_hours_worked") {
    const per = input.vacationAccrualPerHoursWorked ?? 30;
    const earned = input.vacationAccrualHoursPerThreshold ?? 1;
    const capPart = cap != null
      ? `, up to ${fmt(cap)} ${hourWord(cap)} per year`
      : "";
    return `You earn ${fmt(earned)} ${hourWord(earned)} of PTO for every ${fmt(per)} ${hourWord(per)} worked${capPart}. ${carryoverSentence}`;
  }

  if (type === "per_pay_period") {
    const annual = input.accrualHoursPerYear ?? 0;
    const perPeriod = annual ? annual / 26 : 0;
    const capPart = cap != null ? `, capped at ${fmt(cap)} ${hourWord(cap)} per year` : "";
    return `You earn about ${fmt(Math.round(perPeriod * 100) / 100)} ${hourWord(perPeriod)} of PTO each pay period (~${fmt(annual)} ${hourWord(annual)} per year)${capPart}. ${carryoverSentence}`;
  }

  // annual lump sum
  const annual = input.accrualHoursPerYear ?? 0;
  const capPart = cap != null && cap !== annual ? `, capped at ${fmt(cap)} ${hourWord(cap)} per year` : "";
  return `You receive ${fmt(annual)} ${hourWord(annual)} of PTO at the start of each year${capPart}. ${carryoverSentence}`;
}
