'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to send reset link')
      }

      return response.json()
    },
    onSuccess: () => {
      setSubmitted(true)
      toast.success('Password reset link sent to your email')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    mutation.mutate(email)
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-[#00786f]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8 text-[#00786f]" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Check your email</h1>
          <p className="text-sm text-gray-500 mt-2">
            We've sent a password reset link to <span className="font-medium text-gray-900">{email}</span>. 
            Please check your inbox and follow the instructions.
          </p>
          <div className="mt-8">
            <Link 
              href="/auth/sign-in" 
              className="text-[#00786f] font-medium hover:underline flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 text-center">Forgot Password?</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            No worries, we'll send you reset instructions.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2.5 rounded-lg text-black border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00786f] focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full py-2.5 bg-[#00786f] text-white text-sm font-medium rounded-lg hover:bg-[#005a52] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Sending link...
              </>
            ) : (
              'Reset Password'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link 
            href="/auth/sign-in" 
            className="text-gray-900 text-sm font-medium hover:underline flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
