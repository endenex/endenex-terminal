import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn, useAuth, useUser } from '@clerk/clerk-react'
import { supabase } from '@/lib/supabase'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { MarketMonitorPage } from '@/pages/MarketMonitorPage'
import { AssetScreenerPage } from '@/pages/AssetScreenerPage'
import { WorkbenchPage } from '@/pages/WorkbenchPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk publishable key')
}

function RequireAuth() {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded) return <LoadingScreen />
  if (!isSignedIn) return <RedirectToSignIn />
  return <Outlet />
}

function OnboardingGuard() {
  const { user, isLoaded } = useUser()
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isLoaded || !user) return
    supabase
      .from('user_profiles')
      .select('onboarding_completed')
      .eq('clerk_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setOnboardingDone(data?.onboarding_completed ?? false)
      })
  }, [isLoaded, user])

  if (!isLoaded || onboardingDone === null) return <LoadingScreen />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

function RootRedirect() {
  return (
    <>
      <SignedIn>
        <Navigate to="/dashboard" replace />
      </SignedIn>
      <SignedOut>
        <Navigate to="/sign-in" replace />
      </SignedOut>
    </>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* Protected: auth required */}
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* Protected: auth + onboarding required */}
        <Route element={<OnboardingGuard />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/market-monitor" element={<MarketMonitorPage />} />
            <Route path="/asset-screener" element={<AssetScreenerPage />} />
            <Route path="/workbench" element={<WorkbenchPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
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
