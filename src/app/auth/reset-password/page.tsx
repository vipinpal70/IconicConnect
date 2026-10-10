'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from "sonner";
import { Loader2, Lock, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter()

  const [passwords, setPasswords] = useState({ password: '', confirmPassword: '' })
  const [loading, setLoading] = useState(true)
  const [resetting, setResetting] = useState(false)
  const [validSession, setValidSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [token, setToken] = useState('')

  useEffect(() => {
    // The emailed link carries a single-use token; it is verified when the new password is submitted.
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token')
    const errorMsg = params.get('error')
    if (errorMsg) setError(errorMsg)
    if (t) { setToken(t); setValidSession(true) }
    else if (!errorMsg) setError('This reset link is invalid. Please request a new one.')
    setLoading(false)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (passwords.password !== passwords.confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (passwords.password.length < 10) {
      toast.error('Password must be at least 10 characters long')
      return
    }

    setResetting(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: passwords.password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        toast.error(data.error || 'Failed to reset password')
      } else {
        setSuccess(true)
        toast.success('Password reset successful!')
        setTimeout(() => {
          router.push('/auth/sign-in')
        }, 3000)
      }
    } catch (err) {
      toast.error('Failed to reset password')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-[#00786f] animate-spin" />
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Password reset!</h1>
          <p className="text-sm text-gray-500 mt-2">
            Your password has been successfully reset. You will be redirected to the login page shortly.
          </p>
          <div className="mt-8">
            <Link 
              href="/auth/sign-in" 
              className="w-full block py-2.5 bg-[#00786f] text-white text-sm font-medium rounded-lg hover:bg-[#005a52] transition text-center"
            >
              Sign in now
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!validSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Invalid Link</h1>
          <p className="text-sm text-gray-500 mt-2">
            {error || 'This password reset link is invalid or has expired. Please request a new one.'}
          </p>
          <div className="mt-8">
            <Link 
              href="/auth/forgot-password" 
              className="w-full block py-2.5 bg-[#00786f] text-white text-sm font-medium rounded-lg hover:bg-[#005a52] transition text-center"
            >
              Request new link
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
          <h1 className="text-2xl font-semibold text-gray-900 text-center">Set new password</h1>
          <p className="text-sm text-gray-500 mt-1 text-center">
            Please enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={passwords.password}
                onChange={(e) => setPasswords(p => ({ ...p, password: e.target.value }))}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-3 py-2.5 rounded-lg text-black border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00786f] focus:border-transparent transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="password"
                value={passwords.confirmPassword}
                onChange={(e) => setPasswords(p => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-3 py-2.5 rounded-lg text-black border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#00786f] focus:border-transparent transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={resetting}
            className="w-full py-2.5 bg-[#00786f] text-white text-sm font-medium rounded-lg hover:bg-[#005a52] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {resetting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Resetting...
              </>
            ) : (
              'Reset Password'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
