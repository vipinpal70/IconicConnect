import { cn } from "@/src/lib/utils";

// USA Universal Numbering System
// Upper: 1 (UR third molar) → 16 (UL third molar)
// Lower: 17 (LL third molar) → 32 (LR third molar)
const upper = Array.from({ length: 16 }, (_, i) => i + 1);
const lower = Array.from({ length: 16 }, (_, i) => 17 + i).reverse(); // 32..17 left-to-right

interface Props {
  selected: number[];
  onChange: (next: number[]) => void;
}

export function ToothChart({ selected, onChange }: Props) {
  const toggle = (n: number) => {
    if (selected.includes(n)) onChange(selected.filter((x) => x !== n));
    else onChange([...selected, n].sort((a, b) => a - b));
  };

  const Tooth = ({ n }: { n: number }) => {
    const active = selected.includes(n);
    return (
      <button
        type="button"
        onClick={() => toggle(n)}
        className={cn(
          "flex flex-col items-center justify-end gap-1 group transition-transform hover:-translate-y-0.5",
        )}
      >
        <div
          className={cn(
            "w-7 h-9 rounded-md border-2 transition-all",
            active
              ? "bg-primary border-primary shadow-glow"
              : "bg-card border-border group-hover:border-primary/50",
          )}
        />
        <span
          className={cn(
            "text-[10px] font-medium",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {n}
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        <span>Upper Right</span>
        <span>USA Universal Numbering</span>
        <span>Upper Left</span>
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
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        <span>Lower Right</span>
        <span>{selected.length ? `Selected: ${selected.join(", ")}` : "Click teeth to select"}</span>
        <span>Lower Left</span>
      </div>
    </div>
  );
}
