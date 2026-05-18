"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";
import { Eye, EyeOff } from "lucide-react";

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
	title: "",
	email: "",
	phone: "",
	labName: "",
	postalCode: "",
	city: "",
	state: "",
	country: "",
	password: "",
	confirmPassword: "",
};

export default function SignUpPage() {
	const router = useRouter();
	const supabase = createClient();

	const [form, setForm] = useState<FormData>(initial);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		if (form.password !== form.confirmPassword) {
			setError("Passwords do not match.");
			return;
		}
		if (form.password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}

		setLoading(true);

		const { data, error: signUpError } = await supabase.auth.signUp({
			email: form.email,
			password: form.password,
			phone: form.phone
		});

		if (signUpError) {
			setError(signUpError.message);
			setLoading(false);
			return;
		}

		if (data.user) {
			// Now send data to the api endpoint to store info into the table
			const profileRes = await fetch("/api/sign-up", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: data.user.id,
					email: form.email,
					fullName: form.name,
					title: form.title,
					phone: form.phone,
					labName: form.labName,
					postalCode: form.postalCode,
					city: form.city,
					state: form.state,
					country: form.country,
				}),
			});

			if (!profileRes.ok) {
				const errorData = await profileRes.json();
				setError(errorData.error || "Failed to create profile");
				setLoading(false);
				return;
			}
		}

		setLoading(false);
		router.push("/auth/sign-in");
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

					<div className="">
						<h2 className="text-xl font-semibold text-gray-900">
							Please register here!
						</h2>
						<p className="text-sm text-gray-400">
							Join the network — fill in your details below
						</p>
					</div>
				</div>

				<form onSubmit={handleSubmit} className="space-y-6">
					{/* Personal Info */}
					<div>
						<p className="text-[11px] font-medium text-teal-600 tracking-widest uppercase mb-3">
							Personal info
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-black">
							<Field
								label="Full name"
								name="name"
								value={form.name}
								onChange={handleChange}
								required
							/>
							<Field
								label="Title"
								name="title"
								value={form.title}
								onChange={handleChange}
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

					{/* Lab & Location */}
					<div>
						<p className="text-[11px] font-medium text-teal-600 tracking-widest uppercase mb-3">
							Lab &amp; location
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-black">
							<Field
								label="Lab name"
								name="labName"
								value={form.labName}
								onChange={handleChange}
							/>
							<Field
								label="Postal code"
								name="postalCode"
								value={form.postalCode}
								onChange={handleChange}
							/>
							<Field
								label="City"
								name="city"
								value={form.city}
								onChange={handleChange}
							/>
							<Field
								label="State"
								name="state"
								value={form.state}
								onChange={handleChange}
							/>
							<div className="sm:col-span-2">
								<Field
									label="Country"
									name="country"
									value={form.country}
									onChange={handleChange}
								/>
							</div>
						</div>
					</div>

					<hr className="border-gray-100" />

					{/* Security */}
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

					{error && (
						<p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-lg">
							{error}
						</p>
					)}

					<div className="flex items-center justify-between pt-1">
						<button
							type="submit"
							disabled={loading}
							className="px-7 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
						>
							{loading ? "Creating account..." : "Create account"}
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
	const [showPassword, setShowPassword] = useState(false);
	const isPasswordType = type === "password";
	const inputType = isPasswordType ? (showPassword ? "text" : "password") : type;

	return (
		<div>
			<label className="block text-xs font-medium text-gray-500 mb-1.5">
				{label}
			</label>
			<div className="relative">
				<input
					type={inputType}
					name={name}
					value={value}
					onChange={onChange}
					placeholder={placeholder}
					required={required}
					className={`w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition ${isPasswordType ? 'pr-10' : ''}`}
				/>
				{isPasswordType && (
					<button
						type="button"
						onClick={() => setShowPassword(!showPassword)}
						className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
					>
						{showPassword ? (
							<EyeOff className="h-4 w-4" aria-hidden="true" />
						) : (
							<Eye className="h-4 w-4" aria-hidden="true" />
						)}
					</button>
				)}
			</div>
		</div>
	);
}
