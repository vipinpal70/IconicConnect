"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/src/components/AdminLayout";
import { Card, CardContent } from "@/src/components/ui/card";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Badge } from "@/src/components/ui/badge";
import { Building2, Mail, Phone, MapPin, FileText, Plus, ShieldCheck, XCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { caseTypes } from "@/src/data/demoData";
import type { PreferenceFormRecord } from "@/src/lib/preference-forms";

type ClientProfile = {
	id: string;
	fullName: string | null;
	email: string;
	labName: string | null;
	phone: string | null;
	city: string | null;
	state: string | null;
	status: string;
	plan: string;
	createdAt: string;
};

const statusColor: Record<string, string> = {
	Active: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
	Onboarding: "bg-amber-500/10 text-amber-500 border-amber-500/20",
	pending: "bg-blue-500/10 text-blue-500 border-blue-500/20",
	Paused: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

export default function AdminClients() {
	const queryClient = useQueryClient();
	const [activeClient, setActiveClient] = useState<ClientProfile | null>(null);
	const [onboardOpen, setOnboardOpen] = useState(false);

	const { data: clients, isLoading, error } = useQuery<ClientProfile[]>({
		queryKey: ["pendingClients"],
		queryFn: async () => {
			const res = await fetch("/api/admin/clients");
			if (!res.ok) throw new Error("Failed to fetch clients");
			return res.json();
		},
	});

	const approveMutation = useMutation({
		mutationFn: async (clientId: string) => {
			const res = await fetch("/api/admin/clients/approve", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ clientId }),
			});
			if (!res.ok) throw new Error("Failed to approve client");
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["pendingClients"] });
			toast.success("Client approved successfully");
		},
	});

	const { data: preferenceForms, isLoading: preferenceFormsLoading } = useQuery<PreferenceFormRecord[]>({
		queryKey: ["clientPreferenceForms", activeClient?.id],
		queryFn: async () => {
			if (!activeClient) return [];
			const res = await fetch(`/api/preference-forms?clientId=${activeClient.id}`);
			if (!res.ok) throw new Error("Failed to fetch preference forms");
			const data = await res.json();
			return data.data ?? [];
		},
		enabled: !!activeClient,
	});

	if (isLoading) return <LoadingSpinner />;
	if (error) return <ErrorMessage message={(error as Error).message} />;

	return (
		<AdminLayout>
			<div className="space-y-6 animate-fade-in">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold text-foreground">Clients</h1>
						<p className="text-sm text-muted-foreground mt-1">Review registrations, manage profiles and price lists</p>
					</div>
					<Button onClick={() => setOnboardOpen(true)} className="gradient-primary border-none shadow-glow">
						<Plus className="h-4 w-4 mr-2" />
						Onboard Client
					</Button>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{clients?.map((c) => (
						<Card 
							key={c.id} 
							className="shadow-card hover:shadow-glow transition-all cursor-pointer border-border/50 group" 
							onClick={() => setActiveClient(c)}
						>
							<CardContent className="p-5 space-y-4">
								<div className="flex items-start justify-between">
									<div className="flex items-center gap-3 min-w-0">
										<div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0 shadow-sm text-white font-bold">
											{c.labName?.charAt(0) || c.fullName?.charAt(0) || <Building2 className="h-5 w-5 text-white" />}
										</div>
										<div className="min-w-0">
											<p className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
												{c.labName || "No Lab Name"}
											</p>
											<p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{c.id.slice(0, 8)}</p>
										</div>
									</div>
									<Badge variant="outline" className={statusColor[c.status === 'pending' ? 'pending' : c.plan] || statusColor.Active}>
										{c.status === 'pending' ? 'Pending Approval' : c.plan}
									</Badge>
								</div>

								<div className="space-y-2.5">
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<MapPin className="h-3.5 w-3.5 text-primary/60" />
										<span className="truncate">{c.city || "No City"}, {c.state || "No State"}</span>
									</div>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<Mail className="h-3.5 w-3.5 text-primary/60" />
										<span className="truncate">{c.email}</span>
									</div>
									<div className="flex items-center gap-2 text-xs text-muted-foreground">
										<Phone className="h-3.5 w-3.5 text-primary/60" />
										<span>{c.phone || "No Phone"}</span>
									</div>
								</div>

								<div className="flex items-center justify-between pt-3 border-t border-border/50 text-xs">
									<span className="text-muted-foreground">POC: <span className="text-foreground font-medium">{c.fullName}</span></span>
									<span className="text-muted-foreground">Reg: <span className="text-foreground font-medium">{format(new Date(c.createdAt), "MMM dd")}</span></span>
								</div>

								{c.status === 'pending' && (
									<Button 
										className="w-full h-8 text-xs gap-2 mt-2" 
										onClick={(e) => {
											e.stopPropagation();
											approveMutation.mutate(c.id);
										}}
										disabled={approveMutation.isPending}
									>
										<ShieldCheck className="h-3.5 w-3.5" />
										Approve Registration
									</Button>
								)}
							</CardContent>
						</Card>
					))}
				</div>

				{/* Detail Dialog */}
				<Dialog open={!!activeClient} onOpenChange={(o) => !o && setActiveClient(null)}>
					<DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
						{activeClient && (
							<>
								<DialogHeader>
									<DialogTitle className="text-xl flex items-center gap-2">
										{activeClient.labName || "Client Details"}
										<Badge variant="outline" className={statusColor[activeClient.status === 'pending' ? 'pending' : activeClient.plan]}>
											{activeClient.status === 'pending' ? 'Pending Approval' : activeClient.plan}
										</Badge>
									</DialogTitle>
								</DialogHeader>
								<div className="space-y-6 mt-4">
									<div className="grid grid-cols-2 gap-4">
										<Info label="Full Name (POC)" value={activeClient.fullName || "-"} />
										<Info label="Location" value={`${activeClient.city || "-"}, ${activeClient.state || "-"}`} />
										<Info label="Email" value={activeClient.email} />
										<Info label="Phone" value={activeClient.phone || "-"} />
										<Info label="Registered On" value={format(new Date(activeClient.createdAt), "PPP")} />
										<Info label="Current Plan" value={activeClient.plan || "-"} />
									</div>

									<div>
										<p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
											<FileText className="h-4 w-4 text-primary" /> Price List
										</p>
										<div className="rounded-xl border border-border overflow-hidden shadow-sm">
											<table className="w-full text-sm">
												<thead>
													<tr className="border-b border-border bg-muted/30">
														<th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Case Type</th>
														<th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Price (USD)</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-border">
													{caseTypes.map((t) => (
														<tr key={t} className="hover:bg-muted/10 transition-colors">
															<td className="px-4 py-2.5">{t}</td>
															<td className="px-4 py-2.5 text-right font-medium">$20.00</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
										<p className="text-[10px] text-muted-foreground mt-2 italic">Prices shown are default values for this portal.</p>
									</div>

									<div>
										<p className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
											<FileText className="h-4 w-4 text-primary" /> Preference Forms
										</p>
										{preferenceFormsLoading ? (
											<p className="text-sm text-muted-foreground">Loading forms...</p>
										) : (preferenceForms?.length ?? 0) === 0 ? (
											<p className="text-sm text-muted-foreground">No preference forms submitted yet.</p>
										) : (
											<div className="space-y-3">
												{preferenceForms?.map((form) => (
													<Card key={form.id} className="shadow-sm border-border/60">
														<CardContent className="p-4 space-y-3">
															<div className="flex items-start justify-between gap-3">
																<div>
																	<p className="font-medium text-foreground">{form.formName}</p>
																	<p className="text-xs text-muted-foreground">Submitted {format(new Date(form.createdAt), "PPP")}</p>
																</div>
															</div>
															<div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
																<Info label="Occlusion" value={form.payload.occlusion.defaultValues || "-"} />
																<Info label="Proximal Contacts" value={form.payload.proximalContacts.defaultValues || "-"} />
																<Info label="Distal-most Crown" value={form.payload.distalMostCrownContact.defaultValues || "-"} />
																<Info label="Anatomy" value={form.payload.anatomy.option || "-"} />
																<Info label="Smile Library" value={form.payload.smileLibrary.option || "-"} />
																<Info label="Pontic Type" value={form.payload.ponticType.option || "-"} />
																<Info label="Pontic Distance" value={form.payload.ponticDistanceFromTissue.option || "-"} />
																<Info label="Match Marginal Ridge" value={form.payload.matchMarginalRidge.option || "-"} />
															</div>
														</CardContent>
													</Card>
												))}
											</div>
										)}
									</div>

									<div className="flex gap-3 pt-2">
										<Button variant="outline" className="flex-1" onClick={() => toast.info("Price list editing coming soon")}>Edit Price List</Button>
										{activeClient.status === 'pending' && (
											<Button 
												className="flex-1" 
												onClick={() => approveMutation.mutate(activeClient.id)}
												disabled={approveMutation.isPending}
											>
												Approve Now
											</Button>
										)}
									</div>
								</div>
							</>
						)}
					</DialogContent>
				</Dialog>

				{/* Manual Onboard Placeholder */}
				<Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Onboard New Client</DialogTitle>
						</DialogHeader>
						<div className="space-y-4 mt-2">
							<div className="space-y-2"><Label>Company / Lab Name</Label><Input placeholder="PrecisionDent Lab" /></div>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2"><Label>POC Name</Label><Input placeholder="Daniel Ortega" /></div>
								<div className="space-y-2"><Label>City</Label><Input placeholder="Miami" /></div>
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="daniel@lab.com" /></div>
								<div className="space-y-2"><Label>Phone</Label><Input placeholder="+1..." /></div>
							</div>
							<div className="space-y-2"><Label>Notes</Label><Textarea placeholder="Special preferences..." /></div>
							<Button className="w-full gradient-primary border-none shadow-glow" onClick={() => {
								toast.info("Manual onboarding is restricted. Please use the Admin Sign-up link.");
								setOnboardOpen(false);
							}}>Send Invitation</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</AdminLayout>
	);
}

function Info({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl bg-muted/20 border border-border/40 px-4 py-3 shadow-sm hover:border-primary/20 transition-colors">
			<p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider mb-0.5">{label}</p>
			<p className="text-sm text-foreground font-medium truncate">{value}</p>
		</div>
	);
}

function LoadingSpinner() {
	return (
		<AdminLayout>
			<div className="h-[60vh] flex items-center justify-center">
				<div className="relative flex items-center justify-center">
					<div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
					<div className="absolute h-8 w-8 rounded-full bg-primary/10 animate-pulse"></div>
				</div>
			</div>
		</AdminLayout>
	);
}

function ErrorMessage({ message }: { message: string }) {
	return (
		<AdminLayout>
			<div className="h-[60vh] flex items-center justify-center p-4">
				<div className="bg-red-50 border border-red-100 p-6 rounded-2xl shadow-sm max-w-md w-full text-center">
					<div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
						<XCircle className="h-6 w-6 text-red-600" />
					</div>
					<h3 className="text-lg font-semibold text-red-900 mb-1">Error Loading Clients</h3>
					<p className="text-sm text-red-700">{message}</p>
				</div>
			</div>
		</AdminLayout>
	);
}
