import React, { useMemo, useState } from "react";

/**
 * Ladder & Reverse Pyramid Planner — Single-file React app
 * --------------------------------------------------------
 * - Autoregulated training helper for Squat, Deadlift, Bench, Row, OHP, Pull-ups
 * - Two modes per lift: Ladder or Reverse Pyramid (Percent or Fixed Drop)
 * - Computes per-exercise set/rep prescriptions + tonnage and session totals
 * - Defaults based on your scheme: SQ/DL +10 kg, BP/Row +5 kg, OHP +2.5 kg, Pull-up +2.5 kg
 * - Includes start-rep cap for ladder, editable increments, and bodyweight handling for pull-ups
 *
 * Notes:
 * - Pull-up calculations are done on TOTAL system weight (BW +/- external). We also show external load.
 * - RP (Percent) uses the 90/85/80/75/70% × 1–5+ protocol, with "1+ / 2+ ..." shown in the Reps column.
 * - RP (Fixed Drop) uses a top single (as daily max) and N back-off sets, reducing weight each set.
 */

// ---------- Utils ----------
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundToNearest2point5 = (n) => Math.round(n / 2.5) * 2.5;


// ---------- Default lift configs ----------
const BAR = 20;
const DEFAULTS = {
  Squat: { inc: 10, include: true },
  Deadlift: { inc: 10, include: false },
  "Bench Press": { inc: 5, include: true },
  "Barbell Row": { inc: 5, include: false },
  "Overhead Press": { inc: 2.5, include: true },
  "Pull-up": { inc: 2.5, include: true },
};

const LIFTS = Object.keys(DEFAULTS);

// ---------- Core Calculations ----------
function ladderPlan({ dailyMax, increment, startRepCap = 12, isPullup = false, bodyweight = 80 }) {
  if (!dailyMax || !increment) return { sets: [], tonnage: 0, start: null };

  const targetTop = dailyMax; // for pull-ups this is TOTAL system weight (BW ± external)

  let startReps;
  let startWeight;

  if (isPullup) {
    // Pull-up ladder logic: we don't anchor to BW for start reps.
    // We want a practical ladder length (<= cap) that always lands on a 1× at targetTop
    // and allows assisted totals (< BW) to show negative external.
    // Ensure startWeight >= 0 by limiting startReps.
    const maxRungsFromZero = Math.floor(1 + targetTop / increment); // start at >= 0 total
    startReps = Math.max(1, Math.min(startRepCap, maxRungsFromZero));
    startWeight = targetTop - increment * (startReps - 1);
    if (startWeight < 0) startWeight = 0; // safety floor
  } else {
    // Barbell ladder logic: avoid going below the empty bar
    const base = BAR;
    const rawR0 = 1 + (targetTop - base) / increment;
    const r0Rounded = Math.round(rawR0);
    if (r0Rounded <= startRepCap && r0Rounded >= 1) {
      startReps = r0Rounded;
      startWeight = base;
    } else {
      startReps = startRepCap;
      startWeight = targetTop - increment * (startReps - 1);
      if (startWeight < BAR) {
        startWeight = BAR;
        startReps = Math.max(1, Math.min(startRepCap, 1 + Math.floor((targetTop - startWeight) / increment)));
      }
    }
  }

  // Build ladder upward to targetTop
  const sets = [];
  let reps = startReps;
  let w = startWeight;
  let guard = 0;
  while (reps >= 1 && w <= targetTop + 1e-6 && guard < 400) {
    sets.push({ weight: roundToNearest2point5(w), reps });
    reps -= 1;
    w += increment;
    guard++;
  }

  // Ensure final single at targetTop
  const last = sets[sets.length - 1];
  if (!last || Math.abs(last.weight - targetTop) > 2.5 || last.reps !== 1) {
    if (!last || targetTop > last.weight) sets.push({ weight: roundToNearest2point5(targetTop), reps: 1 });
  }


  // Tonnage: barbell uses bar weight; pull-up uses TOTAL system weight
  const tonnage = round2(sets.reduce((sum, s) => sum + s.weight * s.reps, 0));

  // For pull-ups also compute external load column (assist if negative)
  if (isPullup) sets.forEach((s) => (s.external = round2(s.weight - bodyweight)));

  return {
    sets,
    tonnage,
    start: { weight: roundToNearest2point5(startWeight), reps: startReps },
  };
}

function rpPercentPlan({ dailyMax }) {
  if (!dailyMax) return { sets: [], tonnage: 0, heavyReps: 0 };
  const scheme = [
    { pct: 0.9, reps: "1+" },
    { pct: 0.85, reps: "2+" },
    { pct: 0.8, reps: "3+" },
    { pct: 0.75, reps: "4+" },
    { pct: 0.7, reps: "5+" },
  ];
  const sets = scheme.map((s) => ({
    weight: roundToNearest2point5(s.pct * dailyMax),
    reps: s.reps,
    note: `${Math.round(s.pct * 100)}%`,
  }));
  const tonnage = round2(sets.reduce((a, b) => a + b.weight * (parseInt(b.reps) || 0), 0));
  const heavyReps = sets.filter((s) => s.weight >= 0.8 * dailyMax).reduce((a, b) => a + (parseInt(b.reps) || 0), 0);
  return { sets, tonnage, heavyReps };
}

function rpFixedDropPlan({ dailyMax, drop = 10, sets = 4, repScheme = [3, 5, 7, 9] }) {
  if (!dailyMax) return { topSingle: null, sets: [], tonnage: 0 };
  const topSingle = roundToNearest2point5(0.95 * dailyMax); // ~RPE8–9 top single
  let w = topSingle;
  const rows = [];
  for (let i = 0; i < sets; i++) {
    w = w - drop;
    if (w <= 0) break;
    const reps = repScheme[i] ?? repScheme[repScheme.length - 1];
    rows.push({ weight: roundToNearest2point5(w), reps, note: `−${drop} kg` });
  }
  const tonnage = round2(topSingle * 1 + rows.reduce((a, b) => a + b.weight * b.reps, 0));
  return { topSingle, sets: rows, tonnage };
}

// ---------- UI Helpers ----------
function NumberInput({ label, value, setValue, step = 0.5, min = -999, placeholder }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-gray-600">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        className="border rounded-lg px-3 py-2"
      />
    </label>
  );
}

function Select({ label, value, setValue, options }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="border rounded-lg px-3 py-2"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExerciseCard({ name, defaults, bodyweight, setBodyweight }) {
  const [include, setInclude] = useState(defaults.include);
  const [mode, setMode] = useState("Ladder"); // Ladder | RP % | RP Drop
  const [dailyMaxInput, setDailyMaxInput] = useState("");
  const [increment, setIncrement] = useState(String(defaults.inc));
  const [cap, setCap] = useState("12");
  const [dropKg, setDropKg] = useState(name === "Pull-up" ? "2.5" : "10");
  const [dropSets, setDropSets] = useState("4");
  const [dropScheme, setDropScheme] = useState("3,5,7,9");
  const [pullupInputMode, setPullupInputMode] = useState("total"); // total | external

  const isPullup = name === "Pull-up";

  const plan = useMemo(() => {
    if (!include) return null;
    const inc = parseFloat(increment);
    const capNum = parseInt(cap || "12", 10);
    const bw = parseFloat(bodyweight) || 80;

    let dmaxTotal = parseFloat(dailyMaxInput);
    if (!Number.isFinite(dmaxTotal)) return null;

    if (isPullup) {
      if (pullupInputMode === "external") {
        dmaxTotal = bw + dmaxTotal; // allow negative (assistance)
      }
    }
    if (!inc) return null;

    if (mode === "Ladder") {
      return ladderPlan({ dailyMax: dmaxTotal, increment: inc, startRepCap: capNum, isPullup, bodyweight: bw });
    }
    if (mode === "RP %") {
      return { ...rpPercentPlan({ dailyMax: dmaxTotal }), _totalForPullup: dmaxTotal };
    }
    if (mode === "RP Drop") {
      const drop = parseFloat(dropKg || "10");
      const nSets = parseInt(dropSets || "4", 10);
      const scheme = (dropScheme || "3,5,7,9").split(",").map((s) => parseInt(s.trim() || "0", 10)).filter((x) => x > 0);
      return { ...rpFixedDropPlan({ dailyMax: dmaxTotal, drop, sets: nSets, repScheme: scheme }), _totalForPullup: dmaxTotal };
    }
    return null;
  }, [include, mode, dailyMaxInput, increment, cap, dropKg, dropSets, dropScheme, isPullup, pullupInputMode, bodyweight]);

  const results = useMemo(() => {
    if (!plan) return null;

    if (mode === "Ladder") {
      const p = plan;
      return (
        <div className="mt-3">
          <div className="text-xs text-gray-600">Start: {p.start?.weight} kg × {p.start?.reps} reps</div>
          <table className="w-full text-sm mt-2 border">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">Set</th>
                <th className="p-2 text-left">Weight</th>
                <th className="p-2 text-left">Reps</th>
                {isPullup && <th className="p-2 text-left">External (+/−) kg</th>}
              </tr>
            </thead>
            <tbody>
              {p.sets.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">{s.weight}</td>
                  <td className="p-2">{s.reps}</td>
                  {isPullup && <td className="p-2">{s.external}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-sm font-medium">Tonnage: {plan.tonnage} kg</div>
        </div>
      );
    }

    if (mode === "RP %") {
      const bw = parseFloat(bodyweight) || 80;
      const isPU = isPullup;
      return (
        <div className="mt-3">
          <table className="w-full text-sm mt-2 border">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">Set</th>
                <th className="p-2 text-left">Weight</th>
                {isPU && <th className="p-2 text-left">External (+/−)</th>}
                <th className="p-2 text-left">Reps</th>
                <th className="p-2 text-left">%</th>
              </tr>
            </thead>
            <tbody>
              {plan.sets.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">{s.weight}</td>
                  {isPU && <td className="p-2">{roundToNearest2point5(s.weight - bw)}</td>}
                  <td className="p-2">{s.reps}</td>
                  <td className="p-2">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-sm font-medium">Tonnage: {plan.tonnage} kg</div>
          <div className="text-xs text-gray-600">Heavy reps (≥80%): {plan.heavyReps}</div>
        </div>
      );
    }

    if (mode === "RP Drop") {
      const bw = parseFloat(bodyweight) || 80;
      const isPU = isPullup;
      return (
        <div className="mt-3">
          <div className="text-xs text-gray-600">Top single (~95%): {plan.topSingle} kg × 1{isPU ? `  (external ${roundToNearest2point5(plan.topSingle - bw)} kg)` : ""}</div>
          <table className="w-full text-sm mt-2 border">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">Back-off</th>
                <th className="p-2 text-left">Weight</th>
                {isPU && <th className="p-2 text-left">External (+/−)</th>}
                <th className="p-2 text-left">Reps</th>
                <th className="p-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {plan.sets.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">{s.weight}</td>
                  {isPU && <td className="p-2">{roundToNearest2point5(s.weight - bw)}</td>}
                  <td className="p-2">{s.reps}</td>
                  <td className="p-2">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-sm font-medium">Tonnage: {plan.tonnage} kg</div>
        </div>
      );
    }
    return null;
  }, [plan, mode, bodyweight, isPullup]);

  return (
    <div className="border rounded-2xl p-4 shadow-sm bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} />
          <h3 className="font-semibold">{name}</h3>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Select
            label="Mode"
            value={mode}
            setValue={setMode}
            options={[{ label: "Ladder", value: "Ladder" }, { label: "Reverse Pyramid %", value: "RP %" }, { label: "Reverse Pyramid Drop", value: "RP Drop" }]}
          />
          {isPullup && (
            <Select
              label="Pull-up input"
              value={pullupInputMode}
              setValue={setPullupInputMode}
              options={[
                { label: "Total (BW ± load)", value: "total" },
                { label: "External only (+/− kg)", value: "external" },
              ]}
            />
          )}
          <NumberInput
            label={isPullup ? (pullupInputMode === "external" ? "External max (+/− kg)" : "Total max (kg)") : "Daily max / top single (kg)"}
            value={dailyMaxInput}
            setValue={setDailyMaxInput}
            step={0.5}
            min={isPullup && pullupInputMode === "external" ? -200 : 0}
          />
          <NumberInput label="Increment (kg)" value={increment} setValue={setIncrement} step={0.5} />
          
          {/* --- THIS IS THE FIX --- */}
          {/* This uses `invisible` to hide the element while preserving its space, preventing layout shifts. */}
          <div className={mode === 'Ladder' ? 'visible' : 'invisible'}>
            <NumberInput label="Ladder start-rep cap" value={cap} setValue={setCap} step={1} />
          </div>

          {isPullup && setBodyweight && (
            <NumberInput label="Bodyweight (kg)" value={bodyweight} setValue={setBodyweight} step={0.5} />
          )}
        </div>
      </div>

      {mode === "RP Drop" && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          <NumberInput label="Drop per set (kg)" value={dropKg} setValue={setDropKg} step={0.5} />
          <NumberInput label="# back-off sets" value={dropSets} setValue={setDropSets} step={1} />
          <NumberInput label="Rep scheme (e.g., 3,5,7,9)" value={dropScheme} setValue={setDropScheme} step={1} />
        </div>
      )}

      {results}
    </div>
  );
}

function ExerciseList() {
  // State for bodyweight now lives here, where it's actually used.
  const [bodyweight, setBodyweight] = useState("80");

  return (
    <div className="grid gap-4">
      {LIFTS.map((name) => (
        <ExerciseCard
          key={name}
          name={name}
          defaults={DEFAULTS[name]}
          // Pass bodyweight and the setter function only to the Pull-up card
          // For all other cards, these props will be null and won't interfere.
          bodyweight={name === "Pull-up" ? bodyweight : null}
          setBodyweight={name === "Pull-up" ? setBodyweight : null}
        />
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-5xl mx-auto grid gap-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Ladder & Reverse Pyramid Planner</h1>
            <p className="text-gray-600 text-sm">Enter your daily max for each lift, choose Ladder or Reverse Pyramid, and get weights, reps, and tonnage.</p>
            <p className="text-gray-500 text-xs mt-1">Pull-ups: enter total system weight (BW ± load) <em>or</em> external load (use negative kg for assistance). Tables show external (+/−) too.</p>
          </div>
        </header>

        <ExerciseList />

        <footer className="text-xs text-gray-500">
          <p>Tip: Cap ladder start-reps to keep sessions short. For pull-ups, switch to external mode to log assistance (negative kg).</p>
        </footer>
      </div>
    </div>
  );
}

// --- Dev smoke tests (console) ---
export const _test_calcs = { ladderPlan, rpPercentPlan, rpFixedDropPlan };

try {
  // Ladder should end with 1 rep at target for barbell
  const L1 = ladderPlan({ dailyMax: 160, increment: 10 });
  console.assert(L1.sets.slice(-1)[0].reps === 1 && Math.abs(L1.sets.slice(-1)[0].weight - 160) < 2.5, 'Barbell ladder should end with 1× at daily max');

  // Pull-up assisted ladder should produce multiple rungs and negative external values
  const bodyweight = 80;
  const totalMax = 60; // e.g., BW with 20 kg assistance (external = -20)
  const P1 = ladderPlan({ dailyMax: totalMax, increment: 2.5, isPullup: true, bodyweight, startRepCap: 8 });
  console.assert(P1.sets.length >= 3, 'Pull-up assisted ladder should have multiple rungs');
  const negatives = P1.sets.filter(s => (s.weight - bodyweight) < 0).length;
  console.assert(negatives > 0, 'Pull-up ladder should show negative external values for assistance');
  console.assert(Math.abs(P1.sets.slice(-1)[0].weight - totalMax) < 2.5 && P1.sets.slice(-1)[0].reps === 1, 'Pull-up ladder should end with 1× at total max');


  // RP% should have 5 sets and count heavy reps
  const RP = rpPercentPlan({ dailyMax: 100 });
  console.assert(RP.sets.length === 5, 'RP% should have 5 sets');
  console.assert(RP.heavyReps >= 6, 'RP% should count heavy reps (≥80%)');
} catch (e) {
  console.warn('Smoke tests warning:', e);
}