"use client";
import React, { useRef, useState } from "react";
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

const OTP_LENGTH = 6;

export default function AdminSignUp() {
	const router = useRouter();
	const supabase = createClient();

	const [form, setForm] = useState<FormData>(initial);

	// OTP dialog state
	const [showOtp, setShowOtp] = useState(false);
	const [verified, setVerified] = useState(false);
	const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
	const [otpError, setOtpError] = useState<string | null>(null);
	const [otpLoading, setOtpLoading] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	const otpRefs = Array.from({ length: OTP_LENGTH }, () => useRef<HTMLInputElement>(null));

	const startCooldown = () => {
		setResendCooldown(60);
		const interval = setInterval(() => {
			setResendCooldown((prev) => {
				if (prev <= 1) { clearInterval(interval); return 0; }
				return prev - 1;
			});
		}, 1000);
	};

	const sendOtp = async () => {
		const { error } = await supabase.auth.signInWithOtp({
			email: form.email,
			options: { shouldCreateUser: false },
		});
		if (error) console.error("[sendOtp]", error.message);
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
		onSuccess: async () => {
			await sendOtp();
			setShowOtp(true);
			startCooldown();
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

	// OTP input handlers
	const handleOtpChange = (index: number, value: string) => {
		const digit = value.replace(/\D/g, "").slice(-1);
		const next = [...otp];
		next[index] = digit;
		setOtp(next);
		setOtpError(null);
		if (digit && index < OTP_LENGTH - 1) {
			otpRefs[index + 1].current?.focus();
		}
	};

	const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace" && !otp[index] && index > 0) {
			otpRefs[index - 1].current?.focus();
		}
	};

	const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
		if (!pasted) return;
		const next = Array(OTP_LENGTH).fill("");
		pasted.split("").forEach((ch, i) => { next[i] = ch; });
		setOtp(next);
		otpRefs[Math.min(pasted.length, OTP_LENGTH - 1)].current?.focus();
	};

	const handleVerify = async () => {
		const code = otp.join("");
		if (code.length !== OTP_LENGTH) {
			setOtpError("Please enter the complete 6-digit code.");
			return;
		}
		setOtpLoading(true);
		setOtpError(null);

		try {
			// Activate profile (verifies OTP and sets status → active on the server)
			const res = await fetch("/api/admin/activate", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: form.email,
					token: code,
				}),
			});

			if (!res.ok) {
				const errorData = await res.json().catch(() => ({}));
				throw new Error(errorData.error || "Verification failed");
			}

			// Clear all auth state so user must log in fresh
			await supabase.auth.signOut().catch(() => {});
			localStorage.clear();
			sessionStorage.clear();
			document.cookie.split(";").forEach((c) => {
				document.cookie = c
					.replace(/^ +/, "")
					.replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
			});

			setOtpLoading(false);
			setVerified(true);
		} catch (err: any) {
			setOtpError(err.message || "An error occurred during verification");
			setOtpLoading(false);
		}
	};

	const handleResend = async () => {
		if (resendCooldown > 0) return;
		setOtp(Array(OTP_LENGTH).fill(""));
		setOtpError(null);
		await sendOtp();
		startCooldown();
		otpRefs[0].current?.focus();
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

			{/* OTP Verification Dialog */}
			{showOtp && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
					<div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-2xl p-8">
						{verified ? (
							/* ── Success screen ── */
							<>
								<div className="flex justify-center mb-5">
									<div className="w-14 h-14 rounded-full bg-teal-50 flex items-center justify-center">
										<svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									</div>
								</div>
								<h2 className="text-lg font-semibold text-gray-900 text-center mb-1">
									Verification completed
								</h2>
								<p className="text-sm text-gray-500 text-center mb-8">
									Your account is active. Please log in to continue.
								</p>
								<button
									onClick={() => router.push("/auth/sign-in")}
									className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition"
								>
									Login now
								</button>
							</>
						) : (
							/* ── OTP entry screen ── */
							<>
								<div className="flex justify-center mb-5">
									<div className="w-14 h-14 rounded-full bg-teal-50 flex items-center justify-center">
										<svg className="w-7 h-7 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
											<path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
										</svg>
									</div>
								</div>

								<h2 className="text-lg font-semibold text-gray-900 text-center mb-1">
									Verify your email
								</h2>
								<p className="text-sm text-gray-500 text-center mb-6">
									We sent a 6-digit code to{" "}
									<span className="font-medium text-gray-700">{form.email}</span>.
									<br />Enter it below to complete sign-up.
								</p>

								{/* 6-digit OTP boxes */}
								<div className="flex justify-center gap-2.5 mb-5">
									{otp.map((digit, i) => (
										<input
											key={i}
											ref={otpRefs[i]}
											type="text"
											inputMode="numeric"
											maxLength={1}
											value={digit}
											onChange={(e) => handleOtpChange(i, e.target.value)}
											onKeyDown={(e) => handleOtpKeyDown(i, e)}
											onPaste={i === 0 ? handleOtpPaste : undefined}
											className="w-11 h-12 text-center text-lg font-semibold text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition caret-transparent"
											autoFocus={i === 0}
										/>
									))}
								</div>

								{otpError && (
									<p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-lg text-center mb-4">
										{otpError}
									</p>
								)}

								<button
									onClick={handleVerify}
									disabled={otpLoading || otp.join("").length !== OTP_LENGTH}
									className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition mb-3"
								>
									{otpLoading ? "Verifying…" : "Verify & continue"}
								</button>

								<p className="text-xs text-gray-400 text-center">
									Didn't receive the code?{" "}
									<button
										type="button"
										onClick={handleResend}
										disabled={resendCooldown > 0}
										className="text-teal-600 font-medium hover:underline disabled:text-gray-400 disabled:no-underline"
									>
										{resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
									</button>
								</p>
							</>
						)}
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
