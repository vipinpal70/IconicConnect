'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

export default function SignInPage() {
  const router = useRouter()
  // const supabase = createClient() // We'll use the API instead

  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const signinMutation = useMutation({
    mutationFn: async (credentials: typeof form) => {
      const response = await fetch('/api/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to sign in')
      }

      return response.json()
    },
    onSuccess: (data) => {
      if (data.isBlocked) {
        toast.error(data.message, {
          duration: 6000,
        })
        return;
      }

      if (data.session) {
        // Set manual auth-token cookie
        document.cookie = `auth-token=${data.session.access_token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;

        router.push(data.redirectUrl || '/dashboard')
        router.refresh()
      }
    },
    onError: (error: Error) => {
      setError(error.message)
    }
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    signinMutation.mutate(form)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 text-center">Iconic Connect</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2.5 rounded-lg text-black border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={form.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
                className="w-full px-3 py-2.5 rounded-lg text-black border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition pr-10"
              />
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
            </div>
            <div className="flex justify-end mt-1">
              <Link
                href="/auth/forgot-password"
                className="text-xs font-medium text-[#00786f] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={signinMutation.isPending}
            className="w-full py-2.5 bg-[#00786f] text-white text-sm font-medium rounded-lg hover:bg-[#005a52]/80 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
          >
            {signinMutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{' '}
          <Link href="/auth/sign-up" className="text-gray-900 font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}