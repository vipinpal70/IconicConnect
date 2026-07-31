"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { uploadFileInChunks } from "@/src/lib/upload-utils";
import { Card, CardContent } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { fetchProfileWithCache } from "@/src/lib/profile-cache";
import { Label } from "@/src/components/ui/label";
import { toast } from "sonner";
import { Badge } from "@/src/components/ui/badge";
import { createClient } from "@/src/lib/supabase/client";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/src/components/ui/dialog";
import {
	anatomyOptions,
	clonePreferenceFormPayload,
	createPreferenceFormDefaults,
	ponticDistanceOptions,
	ponticTypeOptions,
	smileLibraryOptions,
	yesNoOptions,
	posteriorCutbackOptions,
	anteriorCutbackOptions,
	collarTypeOptions,
	preferredSoftwareOptions,
	distanceToAntagonistOptions,
	taperAngleOptions,
	emergenceProfileOptions,
	screwRetainedCrownOptions,
} from "@/src/lib/preference-forms";
import type {
	PreferenceFormPayload,
	PreferenceFormRecord,
} from "@/src/lib/preference-forms";
import { Plus, PencilLine, Trash2, Copy } from "lucide-react";

type Profile = {
	id: string;
	fullName?: string;
	labName?: string;
	role?: string;
};

type FormState = {
	formName: string;
	payload: PreferenceFormPayload;
};

type FormStep = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS: Record<FormStep, string> = {
	1: "Full Contour Form",
	2: "Facial Cutback",
	3: "Coping",
	4: "Implant Abutment",
	5: "Finally",
};

const emptyForm = (): FormState => ({
	formName: "",
	payload: createPreferenceFormDefaults(),
});

export default function ClientPreferencesPage() {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [forms, setForms] = useState<PreferenceFormRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState<FormState>(emptyForm);
	const [formStep, setFormStep] = useState<FormStep>(1);
	const [modalOpen, setModalOpen] = useState(false);
	const [uploadingFields, setUploadingFields] = useState({
		uploadedImage1: false,
		uploadedImage2: false,
		smileLibraryFile: false,
	});

	const uploadImage = async (
		e: React.ChangeEvent<HTMLInputElement>,
		field: "uploadedImage1" | "uploadedImage2",
	) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const maxLimit = 15 * 1024 * 1024; // 15MB
		if (file.size > maxLimit) {
			alert("File size exceeds the 15MB limit.");
			return;
		}
		const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
		const allowedExtensions = [
			".png",
			".jpg",
			".jpeg",
			".webp",
			".gif",
			".bmp",
			".tiff",
			".tif",
			".svg",
			".heic",
			".heif",
			".ico",
		];
		if (!allowedExtensions.includes(ext)) {
			alert("Unsupported file type.");
			return;
		}

		setUploadingFields((prev) => ({ ...prev, [field]: true }));
		try {
			await uploadFileInChunks(
				file,
				{},
				() => {},
				(data) => {
					updatePayload(field, {
						fileUrl: data.fileUrl,
						fileName: data.fileName,
					});
				},
				(err) => {
					alert(`Failed to upload image: ${err}`);
				},
			);
		} catch (err) {
			console.error(err);
			alert("Failed to upload image");
		} finally {
			setUploadingFields((prev) => ({ ...prev, [field]: false }));
		}
	};

	const uploadLibraryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const maxLimit = 15 * 1024 * 1024; // 15MB
		if (file.size > maxLimit) {
			alert("File size exceeds the 15MB limit.");
			return;
		}

		setUploadingFields((prev) => ({ ...prev, smileLibraryFile: true }));
		try {
			await uploadFileInChunks(
				file,
				{},
				() => {},
				(data) => {
					setDraft((current) => ({
						...current,
						payload: {
							...current.payload,
							smileLibrary: {
								...current.payload.smileLibrary,
								libraryFile: { fileUrl: data.fileUrl, fileName: data.fileName },
							},
						},
					}));
				},
				(err) => {
					alert(`Failed to upload file: ${err}`);
				},
			);
		} catch (err) {
			console.error(err);
			alert("Failed to upload file");
		} finally {
			setUploadingFields((prev) => ({ ...prev, smileLibraryFile: false }));
		}
	};

	useEffect(() => {
		const load = async () => {
			try {
				const supabase = createClient();
				const {
					data: { user },
				} = await supabase.auth.getUser();

				if (!user) {
					setLoading(false);
					return;
				}

				const [profileData, formsRes] = await Promise.all([
					fetchProfileWithCache(),
					fetch("/api/preference-forms", { cache: "no-store" }),
				]);

				if (profileData) {
					setProfile(profileData as Profile);
				}

				if (formsRes.ok) {
					const formsData = await formsRes.json().catch(() => null);
					setForms(formsData?.data ?? []);
				}
			} finally {
				setLoading(false);
			}
		};

		load();
	}, []);

	const headerName = useMemo(
		() => profile?.labName || profile?.fullName || "Preference Forms",
		[profile],
	);

	const refreshForms = async () => {
		const res = await fetch("/api/preference-forms", { cache: "no-store" });
		if (res.ok) {
			const data = await res.json().catch(() => null);
			setForms(data?.data ?? []);
		}
	};

	const closeModal = () => {
		setModalOpen(false);
		setDraft(emptyForm());
		setEditingId(null);
		setFormStep(1);
	};

	const openCreateForm = () => {
		setDraft(emptyForm());
		setEditingId(null);
		setFormStep(1);
		setModalOpen(true);
	};

	const editForm = (form: PreferenceFormRecord) => {
		setEditingId(form.id);
		setDraft({
			formName: form.formName,
			payload: clonePreferenceFormPayload(form.payload),
		});
		setFormStep(1);
		setModalOpen(true);
	};

	const saveForm = async () => {
		if (!draft.formName.trim()) {
			toast.error("Form name is required");
			return;
		}

		setSaving(true);
		try {
			const endpoint = editingId
				? `/api/preference-forms/${editingId}`
				: "/api/preference-forms";
			const res = await fetch(endpoint, {
				method: editingId ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					formName: draft.formName,
					payload: draft.payload,
				}),
			});

			if (!res.ok) {
				const errorBody = await res.json().catch(() => null);
				throw new Error(
					errorBody?.error || `Failed to save preference form (${res.status})`,
				);
			}

			await refreshForms();

			toast.success(
				editingId
					? "Preferences updated successfully"
					: "Preferences saved successfully",
			);
			closeModal();
		} catch (error) {
			console.error(error);
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to save preference form",
			);
		} finally {
			setSaving(false);
		}
	};

	const duplicateForm = async (form: PreferenceFormRecord) => {
		setDuplicatingId(form.id);
		try {
			const res = await fetch("/api/preference-forms", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					formName: `${form.formName} (Copy)`,
					payload: form.payload,
				}),
			});

			if (!res.ok) {
				const errorBody = await res.json().catch(() => null);
				throw new Error(
					errorBody?.error || "Failed to duplicate preference form",
				);
			}

			await refreshForms();
			toast.success("Preference form duplicated");
		} catch (error) {
			console.error(error);
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to duplicate preference form",
			);
		} finally {
			setDuplicatingId(null);
		}
	};

	const deleteForm = async (id: string) => {
		if (!window.confirm("Delete this preference form?")) return;

		const res = await fetch(`/api/preference-forms/${id}`, {
			method: "DELETE",
		});
		if (!res.ok) return;

		setForms((current) => current.filter((form) => form.id !== id));
		if (editingId === id) {
			closeModal();
		}
	};

	const updatePayload = <K extends keyof PreferenceFormPayload>(
		key: K,
		value: PreferenceFormPayload[K],
	) => {
		setDraft((current) => ({
			...current,
			payload: {
				...current.payload,
				[key]: value,
			},
		}));
	};

	return (
		<div className="mx-auto max-w-7xl space-y-4 animate-fade-in">
			<div className="flex flex-col gap-1.5 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="text-xl font-semibold text-foreground">
						{headerName}
					</h1>
					<p className="text-xs text-muted-foreground mt-0.5">
						Create, edit, and manage multiple preference forms linked to your
						account.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					className="gap-1.5 h-8 text-xs w-fit bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 hover:border-emerald-700"
					onClick={openCreateForm}
				>
					<Plus className="h-3.5 w-3.5" />
					New Form
				</Button>
			</div>

			<Card className="shadow-card border-border/50">
				<CardContent className="p-3.5 space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-muted-foreground">
								Saved Forms
							</h3>
							<p className="text-[11px] text-muted-foreground">
								Forms are stored under your account and visible to the admin
								team.
							</p>
						</div>
						<Badge variant="secondary" className="text-[10px] scale-95">
							{loading ? "Loading..." : `${forms.length} form(s)`}
						</Badge>
					</div>

					{forms.length === 0 ? (
						<p className="text-xs text-muted-foreground py-4 text-center">
							No preference forms have been added yet.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-xs border border-border/40 rounded-lg overflow-hidden">
								<thead>
									<tr className="bg-muted/40 border-b border-border/40">
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Form Name
										</th>
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Occlusion
										</th>
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Anatomy
										</th>
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Pontic Type
										</th>
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Created
										</th>
										<th className="text-left px-3 py-2 font-semibold text-muted-foreground">
											Updated
										</th>
										<th className="text-right px-3 py-2 font-semibold text-muted-foreground">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border/30">
									{forms.map((form) => (
										<tr
											key={form.id}
											className="hover:bg-muted/10 transition-colors"
										>
											<td className="px-3 py-2 font-medium text-foreground">
												{form.formName}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{form.payload.occlusion.defaultValues || "-"}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{form.payload.anatomy.option || "-"}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{form.payload.ponticType.option || "-"}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{new Date(form.createdAt).toLocaleDateString()}
											</td>
											<td className="px-3 py-2 text-muted-foreground">
												{new Date(form.updatedAt).toLocaleDateString()}
											</td>
											<td className="px-3 py-2">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7"
														title="Edit"
														onClick={() => editForm(form)}
													>
														<PencilLine className="h-3.5 w-3.5 text-muted-foreground" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7"
														title="Duplicate"
														disabled={duplicatingId === form.id}
														onClick={() => duplicateForm(form)}
													>
														<Copy className="h-3.5 w-3.5 text-muted-foreground" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7 text-destructive hover:bg-destructive/10"
														title="Delete"
														onClick={() => deleteForm(form.id)}
													>
														<Trash2 className="h-3.5 w-3.5" />
													</Button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			<Dialog
				open={modalOpen}
				onOpenChange={(open) => (open ? setModalOpen(true) : closeModal())}
			>
				<DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="text-sm">
							{STEP_LABELS[formStep]}
						</DialogTitle>
						<p className="text-[11px] text-muted-foreground">
							{editingId
								? "Editing preference form"
								: "Add a new preference form"}{" "}
							— Step {formStep} of 5
						</p>
					</DialogHeader>

					<div className="space-y-3.5 animate-fade-in">
						{formStep === 1 && (
							<div className="space-y-3.5 animate-fade-in">
								<Section label="Form Name *">
									<Input
										className="h-8 text-xs"
										value={draft.formName}
										onChange={(e) =>
											setDraft((current) => ({
												...current,
												formName: e.target.value,
											}))
										}
										placeholder="form name"
									/>
								</Section>

								<Section label="Occlusion">
									<div className="grid gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											className="h-8 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
											value={draft.payload.occlusion.defaultValues}
											onChange={(e) =>
												updatePayload("occlusion", {
													...draft.payload.occlusion,
													defaultValues: e.target.value,
												})
											}
											placeholder="Default Values"
										/>
										<Input
											className="h-8 text-xs"
											value={draft.payload.occlusion.comments}
											onChange={(e) =>
												updatePayload("occlusion", {
													...draft.payload.occlusion,
													comments: e.target.value,
												})
											}
											placeholder="Comments"
										/>
									</div>
								</Section>

								<Section label="Proximal Contacts">
									<div className="grid gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											className="h-8 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
											value={draft.payload.proximalContacts.defaultValues}
											onChange={(e) =>
												updatePayload("proximalContacts", {
													...draft.payload.proximalContacts,
													defaultValues: e.target.value,
												})
											}
											placeholder="Default Values"
										/>
										<Input
											className="h-8 text-xs"
											value={draft.payload.proximalContacts.comments}
											onChange={(e) =>
												updatePayload("proximalContacts", {
													...draft.payload.proximalContacts,
													comments: e.target.value,
												})
											}
											placeholder="Comments"
										/>
									</div>
								</Section>

								<Section label="Contact for Distal-most Crown">
									<div className="grid gap-2">
										<Input
											type="number"
											step="0.01"
											min="0"
											className="h-8 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
											value={draft.payload.distalMostCrownContact.defaultValues}
											onChange={(e) =>
												updatePayload("distalMostCrownContact", {
													...draft.payload.distalMostCrownContact,
													defaultValues: e.target.value,
												})
											}
											placeholder="Default Values"
										/>
										<Input
											className="h-8 text-xs"
											value={draft.payload.distalMostCrownContact.comments}
											onChange={(e) =>
												updatePayload("distalMostCrownContact", {
													...draft.payload.distalMostCrownContact,
													comments: e.target.value,
												})
											}
											placeholder="Comments"
										/>
									</div>
								</Section>

								<Section label="Anatomy">
									<ChoiceRow
										name="anatomy"
										value={draft.payload.anatomy.option}
										options={anatomyOptions}
										onChange={(option) =>
											updatePayload("anatomy", {
												...draft.payload.anatomy,
												option,
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.anatomy.comments}
										onChange={(e) =>
											updatePayload("anatomy", {
												...draft.payload.anatomy,
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Smile Library">
									<ChoiceRow
										name="smile-library"
										value={draft.payload.smileLibrary.option}
										options={smileLibraryOptions}
										onChange={(option) =>
											updatePayload("smileLibrary", {
												...draft.payload.smileLibrary,
												option,
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.smileLibrary.libraryName}
										onChange={(e) =>
											updatePayload("smileLibrary", {
												...draft.payload.smileLibrary,
												libraryName: e.target.value,
											})
										}
										placeholder="Name of Library"
									/>
									<Input
										className="h-8 text-xs mt-1.5"
										value={draft.payload.smileLibrary.comments}
										onChange={(e) =>
											updatePayload("smileLibrary", {
												...draft.payload.smileLibrary,
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
									<div className="flex flex-col gap-2 mt-1.5">
										<Label className="text-[11px] font-normal text-muted-foreground">
											Upload Library File (optional)
										</Label>
										{uploadingFields.smileLibraryFile ? (
											<div className="text-xs text-muted-foreground">
												Uploading file...
											</div>
										) : draft.payload.smileLibrary.libraryFile ? (
											<div className="flex items-center gap-2 text-xs">
												<span className="text-emerald-600 font-medium truncate max-w-[200px]">
													✓ {draft.payload.smileLibrary.libraryFile.fileName}
												</span>
												<button
													type="button"
													className="text-destructive hover:underline"
													onClick={() =>
														updatePayload("smileLibrary", {
															...draft.payload.smileLibrary,
															libraryFile: null,
														})
													}
												>
													Remove
												</button>
											</div>
										) : (
											<Input
												type="file"
												className="h-8 text-xs py-1"
												onChange={uploadLibraryFile}
											/>
										)}
									</div>
								</Section>

								<Section label="Pontic Type">
									<ChoiceRow
										name="pontic-type"
										value={draft.payload.ponticType.option}
										options={ponticTypeOptions}
										onChange={(option) =>
											updatePayload("ponticType", {
												...draft.payload.ponticType,
												option,
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.ponticType.comments}
										onChange={(e) =>
											updatePayload("ponticType", {
												...draft.payload.ponticType,
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Pontic Distance From Tissue">
									<ChoiceRow
										name="pontic-distance"
										value={draft.payload.ponticDistanceFromTissue.option}
										options={ponticDistanceOptions}
										onChange={(option) =>
											updatePayload("ponticDistanceFromTissue", {
												...draft.payload.ponticDistanceFromTissue,
												option,
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.ponticDistanceFromTissue.comments}
										onChange={(e) =>
											updatePayload("ponticDistanceFromTissue", {
												...draft.payload.ponticDistanceFromTissue,
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
									<Input
										type="number"
										step="0.01"
										min="0"
										className="h-8 text-xs mt-1.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
										value={draft.payload.ponticDistanceFromTissue.distanceMm}
										onChange={(e) =>
											updatePayload("ponticDistanceFromTissue", {
												...draft.payload.ponticDistanceFromTissue,
												distanceMm: e.target.value,
											})
										}
										placeholder="Distance (mm)"
									/>
								</Section>

								<Section label="Match Marginal Ridge to Occlusal of Opposing">
									<ChoiceRow
										name="match-marginal-ridge"
										value={draft.payload.matchMarginalRidge.option}
										options={yesNoOptions}
										onChange={(option) =>
											updatePayload("matchMarginalRidge", {
												...draft.payload.matchMarginalRidge,
												option,
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.matchMarginalRidge.comments}
										onChange={(e) =>
											updatePayload("matchMarginalRidge", {
												...draft.payload.matchMarginalRidge,
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>
							</div>
						)}

						{formStep === 2 && (
							<div className="space-y-3.5 animate-fade-in">
								<Section label="Posterior Cutback">
									<ChoiceRow
										name="posterior-cutback"
										value={draft.payload.posteriorCutback?.option || ""}
										options={posteriorCutbackOptions}
										onChange={(option) =>
											updatePayload("posteriorCutback", {
												...draft.payload.posteriorCutback,
												option,
												comments:
													draft.payload.posteriorCutback?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.posteriorCutback?.comments || ""}
										onChange={(e) =>
											updatePayload("posteriorCutback", {
												...draft.payload.posteriorCutback,
												option: draft.payload.posteriorCutback?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Anterior Cutback">
									<ChoiceRow
										name="anterior-cutback"
										value={draft.payload.anteriorCutback?.option || ""}
										options={anteriorCutbackOptions}
										onChange={(option) =>
											updatePayload("anteriorCutback", {
												...draft.payload.anteriorCutback,
												option,
												comments: draft.payload.anteriorCutback?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.anteriorCutback?.comments || ""}
										onChange={(e) =>
											updatePayload("anteriorCutback", {
												...draft.payload.anteriorCutback,
												option: draft.payload.anteriorCutback?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>
							</div>
						)}

						{formStep === 3 && (
							<div className="space-y-3.5 animate-fade-in">
								<Section label="Pontic Distance From Tissue">
									<ChoiceRow
										name="coping-pontic-distance"
										value={
											draft.payload.copingPonticDistanceFromTissue?.option || ""
										}
										options={ponticDistanceOptions}
										onChange={(option) =>
											updatePayload("copingPonticDistanceFromTissue", {
												...draft.payload.copingPonticDistanceFromTissue,
												option,
												distanceMm:
													draft.payload.copingPonticDistanceFromTissue
														?.distanceMm || "",
												comments:
													draft.payload.copingPonticDistanceFromTissue
														?.comments || "",
											})
										}
									/>
									<Input
										type="number"
										step="0.01"
										min="0"
										className="h-8 text-xs mt-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
										value={
											draft.payload.copingPonticDistanceFromTissue
												?.distanceMm || ""
										}
										onChange={(e) =>
											updatePayload("copingPonticDistanceFromTissue", {
												...draft.payload.copingPonticDistanceFromTissue,
												option:
													draft.payload.copingPonticDistanceFromTissue
														?.option || "",
												distanceMm: e.target.value,
												comments:
													draft.payload.copingPonticDistanceFromTissue
														?.comments || "",
											})
										}
										placeholder="Distance (mm)"
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={
											draft.payload.copingPonticDistanceFromTissue?.comments ||
											""
										}
										onChange={(e) =>
											updatePayload("copingPonticDistanceFromTissue", {
												...draft.payload.copingPonticDistanceFromTissue,
												option:
													draft.payload.copingPonticDistanceFromTissue
														?.option || "",
												distanceMm:
													draft.payload.copingPonticDistanceFromTissue
														?.distanceMm || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Collar Type">
									<ChoiceRow
										name="coping-collar-type"
										value={draft.payload.copingCollarType?.option || ""}
										options={collarTypeOptions}
										onChange={(option) =>
											updatePayload("copingCollarType", {
												...draft.payload.copingCollarType,
												option,
												comments:
													draft.payload.copingCollarType?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.copingCollarType?.comments || ""}
										onChange={(e) =>
											updatePayload("copingCollarType", {
												...draft.payload.copingCollarType,
												option: draft.payload.copingCollarType?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Create Island - Limited Space">
									<ChoiceRow
										name="coping-create-island"
										value={draft.payload.copingCreateIsland?.option || ""}
										options={yesNoOptions}
										onChange={(option) =>
											updatePayload("copingCreateIsland", {
												...draft.payload.copingCreateIsland,
												option,
												comments:
													draft.payload.copingCreateIsland?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.copingCreateIsland?.comments || ""}
										onChange={(e) =>
											updatePayload("copingCreateIsland", {
												...draft.payload.copingCreateIsland,
												option: draft.payload.copingCreateIsland?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>
							</div>
						)}

						{formStep === 4 && (
							<div className="space-y-3.5 animate-fade-in">
								<Section label="Gingiva Levels (mm)">
									<div className="grid gap-3 sm:grid-cols-2">
										<div className="space-y-1.5">
											<p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
												Anterior
											</p>
											<div className="grid grid-cols-3 gap-1.5">
												<NumberField
													label="Buccal"
													value={
														draft.payload.gingivaLevels?.anteriorBuccal || ""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															anteriorBuccal: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
												<NumberField
													label="Lingual"
													value={
														draft.payload.gingivaLevels?.anteriorLingual || ""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															anteriorLingual: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
												<NumberField
													label="Mesial & Distal"
													value={
														draft.payload.gingivaLevels?.anteriorMesialDistal ||
														""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															anteriorMesialDistal: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
											</div>
										</div>
										<div className="space-y-1.5">
											<p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
												Posterior
											</p>
											<div className="grid grid-cols-3 gap-1.5">
												<NumberField
													label="Buccal"
													value={
														draft.payload.gingivaLevels?.posteriorBuccal || ""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															posteriorBuccal: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
												<NumberField
													label="Lingual"
													value={
														draft.payload.gingivaLevels?.posteriorLingual || ""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															posteriorLingual: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
												<NumberField
													label="Mesial & Distal"
													value={
														draft.payload.gingivaLevels
															?.posteriorMesialDistal || ""
													}
													onChange={(v) =>
														updatePayload("gingivaLevels", {
															...draft.payload.gingivaLevels,
															posteriorMesialDistal: v,
														} as PreferenceFormPayload["gingivaLevels"])
													}
												/>
											</div>
										</div>
									</div>
									<Input
										className="h-8 text-xs mt-1.5"
										value={draft.payload.gingivaLevels?.comments || ""}
										onChange={(e) =>
											updatePayload("gingivaLevels", {
												...draft.payload.gingivaLevels,
												comments: e.target.value,
											} as PreferenceFormPayload["gingivaLevels"])
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Distance to Antagonist">
									<ChoiceRow
										name="distance-to-antagonist"
										value={draft.payload.distanceToAntagonist?.option || ""}
										options={distanceToAntagonistOptions}
										onChange={(option) =>
											updatePayload("distanceToAntagonist", {
												...draft.payload.distanceToAntagonist,
												option,
												comments:
													draft.payload.distanceToAntagonist?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.distanceToAntagonist?.comments || ""}
										onChange={(e) =>
											updatePayload("distanceToAntagonist", {
												...draft.payload.distanceToAntagonist,
												option:
													draft.payload.distanceToAntagonist?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Identification Dots">
									<ChoiceRow
										name="identification-dots"
										value={draft.payload.identificationDots?.option || ""}
										options={yesNoOptions}
										onChange={(option) =>
											updatePayload("identificationDots", {
												...draft.payload.identificationDots,
												option,
												comments:
													draft.payload.identificationDots?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.identificationDots?.comments || ""}
										onChange={(e) =>
											updatePayload("identificationDots", {
												...draft.payload.identificationDots,
												option: draft.payload.identificationDots?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Internal Retention Groove">
									<ChoiceRow
										name="internal-retention-groove"
										value={draft.payload.internalRetentionGroove?.option || ""}
										options={yesNoOptions}
										onChange={(option) =>
											updatePayload("internalRetentionGroove", {
												...draft.payload.internalRetentionGroove,
												option,
												comments:
													draft.payload.internalRetentionGroove?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={
											draft.payload.internalRetentionGroove?.comments || ""
										}
										onChange={(e) =>
											updatePayload("internalRetentionGroove", {
												...draft.payload.internalRetentionGroove,
												option:
													draft.payload.internalRetentionGroove?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Taper Angle">
									<ChoiceRow
										name="taper-angle"
										value={draft.payload.taperAngle?.option || ""}
										options={taperAngleOptions}
										onChange={(option) =>
											updatePayload("taperAngle", {
												...draft.payload.taperAngle,
												option,
												comments: draft.payload.taperAngle?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.taperAngle?.comments || ""}
										onChange={(e) =>
											updatePayload("taperAngle", {
												...draft.payload.taperAngle,
												option: draft.payload.taperAngle?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Emergence Profile">
									<ChoiceRow
										name="emergence-profile"
										value={draft.payload.emergenceProfile?.option || ""}
										options={emergenceProfileOptions}
										onChange={(option) =>
											updatePayload("emergenceProfile", {
												...draft.payload.emergenceProfile,
												option,
												comments:
													draft.payload.emergenceProfile?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.emergenceProfile?.comments || ""}
										onChange={(e) =>
											updatePayload("emergenceProfile", {
												...draft.payload.emergenceProfile,
												option: draft.payload.emergenceProfile?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>

								<Section label="Screw-retained Crown (Hole Size)">
									<ChoiceRow
										name="screw-retained-crown"
										value={draft.payload.screwRetainedCrown?.option || ""}
										options={screwRetainedCrownOptions}
										onChange={(option) =>
											updatePayload("screwRetainedCrown", {
												...draft.payload.screwRetainedCrown,
												option,
												comments:
													draft.payload.screwRetainedCrown?.comments || "",
											})
										}
									/>
									<Input
										className="h-8 text-xs mt-1"
										value={draft.payload.screwRetainedCrown?.comments || ""}
										onChange={(e) =>
											updatePayload("screwRetainedCrown", {
												...draft.payload.screwRetainedCrown,
												option: draft.payload.screwRetainedCrown?.option || "",
												comments: e.target.value,
											})
										}
										placeholder="Comments"
									/>
								</Section>
							</div>
						)}

						{formStep === 5 && (
							<div className="space-y-3.5 animate-fade-in">
								<Section label="Preferred Software">
									<ChoiceRow
										name="preferred-software"
										value={draft.payload.preferredSoftware?.option || ""}
										options={preferredSoftwareOptions}
										onChange={(option) =>
											updatePayload("preferredSoftware", {
												...draft.payload.preferredSoftware,
												option,
											})
										}
									/>
								</Section>

								<Section label="Upload Image 1 (png, jpg or gif - max size 10MB)">
									<div className="flex flex-col gap-2">
										{uploadingFields.uploadedImage1 ? (
											<div className="text-xs text-muted-foreground">
												Uploading image...
											</div>
										) : draft.payload.uploadedImage1 ? (
											<div className="flex items-center gap-2 text-xs">
												<span className="text-emerald-600 font-medium truncate max-w-[200px]">
													✓ {draft.payload.uploadedImage1.fileName}
												</span>
												<button
													type="button"
													className="text-destructive hover:underline"
													onClick={() => updatePayload("uploadedImage1", null)}
												>
													Remove
												</button>
											</div>
										) : (
											<Input
												type="file"
												accept="image/*"
												className="h-8 text-xs py-1"
												onChange={(e) => uploadImage(e, "uploadedImage1")}
											/>
										)}
									</div>
								</Section>

								<Section label="Upload Image 2 (png, jpg or gif - max size 10MB)">
									<div className="flex flex-col gap-2">
										{uploadingFields.uploadedImage2 ? (
											<div className="text-xs text-muted-foreground">
												Uploading image...
											</div>
										) : draft.payload.uploadedImage2 ? (
											<div className="flex items-center gap-2 text-xs">
												<span className="text-emerald-600 font-medium truncate max-w-[200px]">
													✓ {draft.payload.uploadedImage2.fileName}
												</span>
												<button
													type="button"
													className="text-destructive hover:underline"
													onClick={() => updatePayload("uploadedImage2", null)}
												>
													Remove
												</button>
											</div>
										) : (
											<Input
												type="file"
												accept="image/*"
												className="h-8 text-xs py-1"
												onChange={(e) => uploadImage(e, "uploadedImage2")}
											/>
										)}
									</div>
								</Section>
							</div>
						)}

						<div className="pt-2 flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								className="h-8 text-xs bg-slate-600 hover:bg-slate-700 text-white disabled:bg-slate-300 disabled:text-slate-500"
								disabled={formStep === 1}
								onClick={() =>
									setFormStep((step) =>
										step > 1 ? ((step - 1) as FormStep) : step,
									)
								}
							>
								Previous
							</Button>

							{formStep < 5 ? (
								<Button
									type="button"
									size="sm"
									className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
									onClick={() =>
										setFormStep((step) =>
											step < 5 ? ((step + 1) as FormStep) : step,
										)
									}
								>
									Next
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									className="h-8 text-xs bg-teal-700 hover:bg-teal-800 text-white"
									onClick={saveForm}
									disabled={
										saving ||
										uploadingFields.uploadedImage1 ||
										uploadingFields.uploadedImage2 ||
										uploadingFields.smileLibraryFile
									}
								>
									{saving
										? "Submitting..."
										: editingId
											? "Submit (Update)"
											: "Submit"}
								</Button>
							)}
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function Section({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs font-semibold text-muted-foreground">
				{label}
			</Label>
			{children}
		</div>
	);
}

function ChoiceRow<T extends string>({
	name,
	value,
	options,
	onChange,
}: {
	name: string;
	value: T | "";
	options: readonly T[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
			{options.map((option) => (
				<label
					key={option}
					className="flex items-center gap-1.5 cursor-pointer"
				>
					<input
						type="radio"
						name={name}
						checked={value === option}
						onChange={() => onChange(option)}
						className="h-3 w-3 border-border text-primary focus:ring-primary"
					/>
					<span className="text-foreground">{option}</span>
				</label>
			))}
		</div>
	);
}

function NumberField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-1">
			<Label className="text-[10px] font-normal text-muted-foreground">
				{label}
			</Label>
			<Input
				type="number"
				step="0.01"
				min="0"
				className="h-8 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
