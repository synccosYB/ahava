---
name: Take Break / employee break feature
description: Durable design constraints for the employee break capability — how "on break" is modeled and how break time deducts from pay.
---

# Take Break capability — design constraints

Employees can take/end a break while clocked in. These are the non-obvious rules
that must hold across any future change:

- **"On break" is derived PURELY from a break-start timestamp being set.** Never
  overload punch `status` for break state — open-shift detection must stay keyed
  on clock-in present + clock-out absent (see open-punch-definition.md).
  **Why:** status is already split across surfaces (kiosk='present',
  web='in-progress'); a break status would reintroduce the stuck-punch bug class.

- **Single break-minutes deduction path — no parallel calc.** Ending a break
  folds elapsed whole minutes into the ONE break-minutes accumulator that every
  pay/attendance surface already subtracts. There is NO other auto-deduction of
  breaks anywhere, so folding is safe and never double-counts.
  **How to apply:** if you add any new break input, route it through that same
  accumulator, not a separate field/calc.

- **Every shift-closing path must fold an in-progress break AND clear the
  marker.** This means manual web clock-out, kiosk clock-out, AND the background
  auto clock-out job — miss one and an auto-closed shift silently under-deducts
  paid hours and leaves an orphaned open break.
  **Why:** this was the exact gap caught in review — auto clock-out originally
  ignored the live break.
  **How to apply:** for auto clock-out, measure the break elapsed only up to the
  CAPPED effective close (clock-in + cap), NOT wall-clock job-run time — a late
  job would otherwise count break minutes past the clock-out and underpay.

- **One live-timer source for all surfaces.** The dashboard card and the floating
  widget share a single hook + query key so they stay in sync; seed "now" at
  mount and optimistically prime the status cache on clock-in, or the counter
  starts a few seconds late.
