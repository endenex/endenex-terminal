import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ClerkProvider, RedirectToSignIn, SignOutButton, useAuth, useUser } from '@clerk/clerk-react'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) throw new Error('Missing Clerk publishable key')

// Comma-separated list of permitted email addresses.
// Set VITE_ALLOWED_EMAILS in .env.local — e.g. alex@endenex.com
const ALLOWED_EMAILS: Set<string> = new Set(
  (import.meta.env.VITE_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
)

function AccessDenied() {
  const { user } = useUser()
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-[#0A0E13] gap-6 font-mono">
      <div className="text-center space-y-2">
        <p className="text-xs tracking-widest text-terminal-muted uppercase">Access Restricted</p>
        <p className="text-sm text-terminal-text">
          {user?.primaryEmailAddress?.emailAddress} is not authorised to access this terminal.
        </p>
      </div>
      <SignOutButton>
        <button className="text-xs text-terminal-teal hover:underline">Sign out</button>
      </SignOutButton>
    </div>
  )
}

function RequireAuth() {
  const { isSignedIn, isLoaded } = useAuth()
  const { user } = useUser()

  if (!isLoaded) return <LoadingScreen />
  if (!isSignedIn) return <RedirectToSignIn />

  // If an allowlist is configured, enforce it
  if (ALLOWED_EMAILS.size > 0) {
    const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? ''
    if (!ALLOWED_EMAILS.has(email)) return <AccessDenied />
  }

  return <Outlet />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/*" element={<AppShell />} />
      </Route>
      <Route path="*" element={<Navigate to="/sign-in" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ClerkProvider>
  )
}
