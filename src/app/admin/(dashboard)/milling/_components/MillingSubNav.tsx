"use client"

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/src/lib/utils";

const SUB_NAV = [
  { href: "/admin/milling/overview", label: "Overview" },
  { href: "/admin/milling/centers", label: "Centres" },
  { href: "/admin/milling/routing", label: "Routing" },
  { href: "/admin/milling/analytics", label: "Analytics" },
];

export function MillingSubNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
      {SUB_NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm transition",
            pathname === item.href
              ? "bg-primary text-primary-foreground font-medium shadow-glow"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
