"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { useMutation } from "@tanstack/react-query";
import { X, CheckCircle2 } from "lucide-react";


type FormData = {
	name: string;
	email: string;
	phone: string;
	password: string;
	confirmPassword: string;
};


const initial: FormData = {
	name: "",
	email: "",
	phone: "",
	password: "",
	confirmPassword: "",
};



export default function AdminSignUp() {
	const router = useRouter();
	const supabase = createClient();

	const [form, setForm] = useState<FormData>(initial);
	const [showSuccess, setShowSuccess] = useState(false);

	const handleCloseSuccess = () => {
		router.push("/auth/sign-in");
	};

	const signupMutation = useMutation({
		mutationFn: async (formData: FormData) => {
			const { data: { session } } = await supabase.auth.getSession();

			const response = await fetch("/api/admin/user", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${session?.access_token}`,
					"x-admin-secret": process.env.NEXT_PUBLIC_ADMIN_SIGNUP_SECRET || "",
				},
				body: JSON.stringify({
					email: formData.email,
					password: formData.password,
					fullName: formData.name,
					phone: formData.phone,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || "Failed to create account");
			}

			return response.json();
		},
		onSuccess: () => {
			setShowSuccess(true);
		},
	});

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (form.password !== form.confirmPassword) return;
		if (form.password.length < 8) return;
		signupMutation.mutate(form);
	};

	return (
		<div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
			<div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-100 p-8">
				{/* Brand */}
				<div className="flex justify-between items-start mb-6">
					<div>
						<h1 className="text-xl font-semibold text-gray-900">
							Iconic<span className="text-teal-600"> Connect</span>
						</h1>
					</div>
				</div>

				<form onSubmit={handleSubmit} className="space-y-6">
					{/* Personal Info */}
					<div>
						<p className="text-[11px] font-medium text-teal-600 tracking-widest uppercase mb-3">
							Personal info
						</p>
						<div className="grid grid-cols-1 gap-3 text-black">
							<Field label="Full name" name="name" value={form.name} onChange={handleChange} required />
							<Field label="Email" name="email" type="email" value={form.email} onChange={handleChange} required />
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1.5">Phone</label>
								<div className="flex gap-2">
									<span className="flex items-center gap-1.5 px-3 border border-gray-200 rounded-lg text-sm text-gray-500 bg-gray-50 whitespace-nowrap">
										🇮🇳 <span className="text-xs">+91</span>
									</span>
									<input
										type="tel"
										name="phone"
										value={form.phone}
										onChange={handleChange}
										className="flex-1 px-3 py-2.5 text-gray-900 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
									/>
								</div>
							</div>
						</div>
					</div>

					<hr className="border-gray-100" />

					<div>
						<p className="text-[11px] font-medium text-teal-600 tracking-widest uppercase mb-3">
							Security
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-black">
							<div>
								<Field label="Password" name="password" type="password" value={form.password} onChange={handleChange} placeholder="••••••••" required />
								<p className="text-xs text-gray-400 mt-1">Min. 8 characters</p>
							</div>
							<Field label="Confirm password" name="confirmPassword" type="password" value={form.confirmPassword} onChange={handleChange} placeholder="••••••••" required />
						</div>
					</div>

					{form.password !== form.confirmPassword && form.confirmPassword && (
						<p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-lg">
							Passwords do not match.
						</p>
					)}

					{signupMutation.isError && (
						<p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-lg">
							{signupMutation.error.message}
						</p>
					)}

					<div className="flex items-center justify-between pt-1">
						<button
							type="submit"
							disabled={signupMutation.isPending}
							className="px-7 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
						>
							{signupMutation.isPending ? "Creating account…" : "Create account"}
						</button>
						<p className="text-sm text-gray-400">
							Already registered?{" "}
							<Link href="/auth/sign-in" className="text-teal-600 font-medium hover:underline">
								Sign in
							</Link>
						</p>
					</div>
				</form>
			</div>

			{showSuccess && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
					<div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl relative border border-gray-100 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
						{/* Close X button */}
						<button
							onClick={handleCloseSuccess}
							className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
							aria-label="Close"
						>
							<X className="h-5 w-5" />
						</button>

						{/* Content */}
						<div className="flex flex-col items-center text-center mt-4">
							<div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 mb-4 animate-bounce">
								<CheckCircle2 className="h-8 w-8" />
							</div>
							<h3 className="text-lg font-semibold text-gray-900 mb-2">
								Account Created Successfully!
							</h3>
							<p className="text-sm text-gray-500 mb-6">
								Your admin account has been created. You can now sign in using your credentials.
							</p>
							<button
								onClick={handleCloseSuccess}
								className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg text-sm transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
							>
								Go to Sign In
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}



function Field({
	label,
	name,
	value,
	onChange,
	placeholder,
	type = "text",
	required = false,
}: {
	label: string;
	name: string;
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	placeholder?: string;
	type?: string;
	required?: boolean;
}) {
	return (
		<div>
			<label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
			<input
				type={type}
				name={name}
				value={value}
				onChange={onChange}
				placeholder={placeholder}
				required={required}
				className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition"
			/>
		</div>
	);
}

