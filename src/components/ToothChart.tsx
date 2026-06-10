// import { cn } from "@/src/lib/utils";

// // USA Universal Numbering System
// // Upper: 1 (UR third molar) → 16 (UL third molar)
// // Lower: 17 (LL third molar) → 32 (LR third molar)
// const upper = Array.from({ length: 16 }, (_, i) => i + 1);
// const lower = Array.from({ length: 16 }, (_, i) => 17 + i).reverse(); // 32..17 left-to-right

// interface Props {
//   selected: number[];
//   onChange: (next: number[]) => void;
// }

// export function ToothChart({ selected, onChange }: Props) {
//   const toggle = (n: number) => {
//     if (selected.includes(n)) onChange(selected.filter((x) => x !== n));
//     else onChange([...selected, n].sort((a, b) => a - b));
//   };

//   const Tooth = ({ n }: { n: number }) => {
//     const active = selected.includes(n);
//     return (
//       <button
//         type="button"
//         onClick={() => toggle(n)}
//         className={cn(
//           "flex flex-col items-center justify-end gap-1 group transition-transform hover:-translate-y-0.5",
//         )}
//       >
//         <div
//           className={cn(
//             "w-7 h-9 rounded-md border-2 transition-all",
//             active
//               ? "bg-primary border-primary shadow-glow"
//               : "bg-card border-border group-hover:border-primary/50",
//           )}
//         />
//         <span
//           className={cn(
//             "text-[10px] font-medium",
//             active ? "text-primary" : "text-muted-foreground",
//           )}
//         >
//           {n}
//         </span>
//       </button>
//     );
//   };

//   return (
//     <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
//       <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1">
//         <span>Upper Right</span>
//         <span>USA Universal Numbering</span>
//         <span>Upper Left</span>
//       </div>
//       <div className="flex justify-center gap-1">
//         {upper.map((n) => (
//           <Tooth key={n} n={n} />
//         ))}
//       </div>
//       <div className="border-t border-dashed border-border" />
//       <div className="flex justify-center gap-1">
//         {lower.map((n) => (
//           <Tooth key={n} n={n} />
//         ))}
//       </div>
//       <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1">
//         <span>Lower Right</span>
//         <span>{selected.length ? `Selected: ${selected.join(", ")}` : "Click teeth to select"}</span>
//         <span>Lower Left</span>
//       </div>
//     </div>
//   );
// }



import { useState, useRef } from "react";
import { cn } from "@/src/lib/utils";

// Static arrays representing the visual left-to-right layout for both systems
const UPPER_USA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER_USA = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

const UPPER_FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_FDI = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

// Mapping dictionaries to preserve selections when toggling between systems
const USA_TO_FDI: Record<number, number> = {
  1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
  9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
  17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
  25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48,
};

const FDI_TO_USA: Record<number, number> = Object.fromEntries(
  Object.entries(USA_TO_FDI).map(([k, v]) => [v, Number(k)])
);

interface Props {
  selected: number[];
  onChange: (next: number[]) => void;
  system?: "USA" | "FDI";
  onChangeSystem?: (system: "USA" | "FDI") => void;
}

export function ToothChart({ selected, onChange, system: controlledSystem, onChangeSystem }: Props) {
  const [internalSystem, setInternalSystem] = useState<"USA" | "FDI">("USA");
  const system = controlledSystem ?? internalSystem;

  const upper = system === "USA" ? UPPER_USA : UPPER_FDI;
  const lower = system === "USA" ? LOWER_USA : LOWER_FDI;

  // Anchor tooth for Ctrl+click range selection — resets only on plain clicks
  const anchorRef = useRef<number | null>(null);

  const toggleSystem = (newSystem: "USA" | "FDI") => {
    if (newSystem === system) return;

    // Translate the stored selected teeth to the new numbering system
    const translated = selected
      .map((tooth) => (newSystem === "FDI" ? USA_TO_FDI[tooth] : FDI_TO_USA[tooth]))
      .filter(Boolean)
      .sort((a, b) => a - b);

    anchorRef.current = null;
    onChange(translated);
    if (onChangeSystem) {
      onChangeSystem(newSystem);
    } else {
      setInternalSystem(newSystem);
    }
  };

  const toggleTooth = (n: number, ctrlKey: boolean) => {
    // Visual order: upper row left-to-right, then lower row left-to-right
    const allTeeth = [...upper, ...lower];

    if (ctrlKey && anchorRef.current !== null) {
      // Range selection: select all teeth between anchor and n (inclusive)
      const fromIdx = allTeeth.indexOf(anchorRef.current);
      const toIdx = allTeeth.indexOf(n);

      if (fromIdx !== -1 && toIdx !== -1) {
        const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeTeeth = allTeeth.slice(start, end + 1);
        const merged = Array.from(new Set([...selected, ...rangeTeeth])).sort((a, b) => a - b);
        onChange(merged);
        return;
      }
    }

    // Plain click — update anchor and toggle the tooth
    anchorRef.current = n;
    if (selected.includes(n)) {
      onChange(selected.filter((x) => x !== n));
    } else {
      onChange([...selected, n].sort((a, b) => a - b));
    }
  };

  const Tooth = ({ n }: { n: number }) => {
    const active = selected.includes(n);
    return (
      <button
        type="button"
        onClick={(e) => toggleTooth(n, e.ctrlKey)}
        className={cn(
          "flex flex-col items-center justify-end gap-1 group transition-transform hover:-translate-y-0.5"
        )}
      >
        <div
          className={cn(
            "w-7 h-9 rounded-md border-2 transition-all",
            active
              ? "bg-primary border-primary shadow-glow"
              : "bg-card border-border group-hover:border-primary/50"
          )}
        />
        <span
          className={cn(
            "text-[10px] font-medium",
            active ? "text-primary" : "text-muted-foreground"
          )}
        >
          {n}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-2">
        <span className="w-24">Upper Right</span>

        {/* System Toggle Controls */}
        <div className="flex bg-muted p-0.5 rounded-md border border-border">
          <button
            type="button"
            onClick={() => toggleSystem("USA")}
            className={cn(
              "px-3 py-1 rounded-sm transition-all font-semibold",
              system === "USA"
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground text-muted-foreground"
            )}
          >
            Universal
          </button>
          <button
            type="button"
            onClick={() => toggleSystem("FDI")}
            className={cn(
              "px-3 py-1 rounded-sm transition-all font-semibold",
              system === "FDI"
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground text-muted-foreground"
            )}
          >
            FDI
          </button>
        </div>

        <span className="w-24 text-right">Upper Left</span>
      </div>

      <div className="flex justify-center gap-1">
        {upper.map((n) => (
          <Tooth key={n} n={n} />
        ))}
      </div>

      <div className="border-t border-dashed border-border" />

      <div className="flex justify-center gap-1">
        {lower.map((n) => (
          <Tooth key={n} n={n} />
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1 mt-2">
        <span className="w-24">Lower Right</span>
        <span>
          {selected.length
            ? `Selected: ${selected.join(", ")}`
            : "Click to select · Ctrl+click to select range"}
        </span>
        <span className="w-24 text-right">Lower Left</span>
      </div>
    </div>
  );
}