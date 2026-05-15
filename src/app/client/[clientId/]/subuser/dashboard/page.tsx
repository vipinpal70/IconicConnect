"use client";

import { SubLayout } from "@/src/components/SubLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { StatusBadge } from "@/src/components/StatusBadge";
import { cases } from "@/src/data/demoData";
import { FolderOpen, Inbox, Clock } from "lucide-react";
import { use } from "react";

export default function SubUserDashboard({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const myCases = cases.slice(0, 3); // Mocking restricted view

  return (
    <SubLayout>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Team Member Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Assigned to client lab: {clientId}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="shadow-card border-border/50">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10 text-primary"><FolderOpen className="h-5 w-5" /></div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Assigned Cases</p>
                <p className="text-2xl font-bold text-foreground">8</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500"><Inbox className="h-5 w-5" /></div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Pending Action</p>
                <p className="text-2xl font-bold text-foreground">2</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card border-border/50">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-500"><Clock className="h-5 w-5" /></div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Avg TAT</p>
                <p className="text-2xl font-bold text-foreground">4.2d</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Active Designs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {myCases.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{c.id} · {c.restoration}</p>
                  <p className="text-[11px] text-muted-foreground">{c.caseType} · Patient {c.patientRef}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </SubLayout>
  );
}
