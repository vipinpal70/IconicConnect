"use client"

import { use } from "react";
import { OpsLayout } from "@/src/components/OpsLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { StatusBadge } from "@/src/components/StatusBadge";
import { CaseChat } from "@/src/components/CaseChat";
import { cases, type CaseStatus } from "@/src/data/demoData";
import { ArrowLeft, MessageSquare, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";

const lifecycle: CaseStatus[] = [
  "Submitted",
  "In Validation",
  "In Design",
  "Internal QC",
  "Pending Client Approval",
  "Completed",
];

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (cases as any[]).find((x) => x.id === id);

  if (!c) {
    return (
      <OpsLayout>
        <div className="text-center py-20 text-muted-foreground">Case not found</div>
      </OpsLayout>
    );
  }

  const currentIndex = Math.max(lifecycle.indexOf(c.status), 0);

  return (
    <OpsLayout>
      <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" onClick={() => router.push("/cases")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{c.id} · {c.restoration}</h1>
            <p className="text-sm text-muted-foreground">{c.caseType} · Patient ref {c.patientRef}</p>
          </div>
          <div className="ml-auto"><StatusBadge status={c.status} /></div>
        </div>

        {/* Lifecycle */}
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Case Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center overflow-x-auto pb-4 pt-2">
              {lifecycle.map((step, i) => {
                const done = i < currentIndex || c.status === "Completed";
                const current = i === currentIndex;
                return (
                  <div key={step} className="flex items-center">
                    <div className="flex flex-col items-center min-w-[140px]">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold transition-all border-2 ${
                          current ? "border-primary bg-primary text-white shadow-glow"
                            : done ? "border-primary bg-primary text-white"
                            : "border-muted bg-muted/30 text-muted-foreground"
                        }`}
                      >
                        {done && !current ? "✓" : i + 1}
                      </div>
                      <span className={`text-[11px] mt-2 font-medium px-2 text-center ${current ? "text-primary" : "text-muted-foreground"}`}>
                        {step}
                      </span>
                    </div>
                    {i < lifecycle.length - 1 && (
                      <div className={`w-16 h-0.5 ${done ? "bg-primary" : "bg-border"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Details */}
          <Card className="shadow-card lg:col-span-1">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="text-base font-medium">Case Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm mt-4">
              <Row k="Case Type" v={c.caseType} />
              <Row k="Restoration" v={c.restoration} />
              <Row k="Model Required" v={c.modelRequired ? "Yes" : "No"} />
              <Row k="Teeth" v={c.toothNumbers.length ? `#${c.toothNumbers.join(", #")}` : "—"} />
              <Row k="Designer" v={c.designer ?? "Not yet allocated"} />
              <Row k="QC Lead" v={c.qcLead ?? "—"} />
              <Row k="Submitted" v={c.createdAt} />
              <Row k="Due Date" v={c.dueDate} />
              <div className="pt-4 border-t border-border/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
                <p className="text-foreground leading-relaxed">{c.notes || "—"}</p>
              </div>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="shadow-card lg:col-span-2">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="text-base font-medium">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="mt-4">
              <div className="space-y-6">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {c.timeline?.map((t: any, i: number) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-primary ring-4 ring-primary/10 mt-1.5 shrink-0" />
                      {i < c.timeline.length - 1 && <div className="w-0.5 flex-1 bg-border mt-2" />}
                    </div>
                    <div className="pb-2">
                      <p className="text-sm font-medium text-foreground">{t.event}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t.date} · {t.actor}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Approval Section */}
        {c.status === "Pending Client Approval" && (
          <Card className="shadow-card border-yellow-200 bg-yellow-50/30">
            <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-base">Design Ready for Review</h3>
                  <p className="text-sm text-muted-foreground">Please approve the design to move to production or request changes.</p>
                </div>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <Button className="flex-1 sm:flex-none">Approve</Button>
                <Button variant="outline" className="flex-1 sm:flex-none bg-white">Request Changes</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Chat */}
        <Card className="shadow-card overflow-hidden">
          <CardHeader className="pb-4 border-b border-border/50 bg-muted/10">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" /> Case Chat
              <span className="text-xs font-normal text-muted-foreground ml-1">— with Iconic Connect Team</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <CaseChat 
              caseId={c.id} 
              side="lab" 
              className="border-none rounded-none"
              heightClass="h-[500px]"
            />
          </CardContent>
        </Card>
      </div>
    </OpsLayout>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground font-semibold text-right">{v}</span>
    </div>
  );
}
