"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { useMutation } from "@tanstack/react-query";

type FormData = {
	name: string;
	title: string;
	email: string;
	phone: string;
	labName: string;
	postalCode: string;
	city: string;
	state: string;
	country: string;
	password: string;
	confirmPassword: string;
};

const initial: FormData = {
	name: "",
	email: "",
	phone: "",
	password: "",
	confirmPassword: "",
	title: "",
	labName: "",
	postalCode: "",
	city: "",
	state: "",
	country: ""
};

export default function adminSignUp() {
	const router = useRouter();
	const supabase = createClient();

	const [form, setForm] = useState<FormData>(initial);
	const [success, setSuccess] = useState(false);

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
			setSuccess(true);
		},
	});

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (form.password !== form.confirmPassword) {
			return; // Handled by manual error display or we can use mutation error
		}
		if (form.password.length < 8) {
			return;
		}

		signupMutation.mutate(form);
	};

	if (success) {
		router.push("/admin/dashboard");
		return;
	}

	return (
		<div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
			<div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-100 p-8">
				{/* Brand */}
				<div className="flex justify-between items-start mb-6">
					<div className="">
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
							<Field
								label="Full name"
								name="name"
								value={form.name}
								onChange={handleChange}
								required
							/>
							<Field
								label="Email"
								name="email"
								type="email"
								value={form.email}
								onChange={handleChange}
								required
							/>
							<div>
								<label className="block text-xs font-medium text-gray-500 mb-1.5">
									Phone
								</label>
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
								<Field
									label="Password"
									name="password"
									type="password"
									value={form.password}
									onChange={handleChange}
									placeholder="••••••••"
									required
								/>
								<p className="text-xs text-gray-400 mt-1">Min. 8 characters</p>
							</div>
							<Field
								label="Confirm password"
								name="confirmPassword"
								type="password"
								value={form.confirmPassword}
								onChange={handleChange}
								placeholder="••••••••"
								required
							/>
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
							{signupMutation.isPending ? "Creating account..." : "Create account"}
						</button>
						<p className="text-sm text-gray-400">
							Already registered?{" "}
							<Link
								href="/auth/sign-in"
								className="text-teal-600 font-medium hover:underline"
							>
								Sign in
							</Link>
						</p>
					</div>
				</form>
			</div>
		</div>
	);
}

// Reusable field component
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
			<label className="block text-xs font-medium text-gray-500 mb-1.5">
				{label}
			</label>
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
