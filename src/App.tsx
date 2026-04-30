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
import { DciPage } from '@/pages/DciPage'
import { RetirementPage } from '@/pages/RetirementPage'
import { MaterialsPage } from '@/pages/MaterialsPage'
import { BladesPage } from '@/pages/BladesPage'
import { WatchPage } from '@/pages/WatchPage'
import { PortfolioPage } from '@/pages/PortfolioPage'

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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* Protected: auth required */}
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* Protected: auth + onboarding required */}
        <Route element={<OnboardingGuard />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dci" element={<DciPage />} />
            <Route path="/retirement" element={<RetirementPage />} />
            <Route path="/materials" element={<MaterialsPage />} />
            <Route path="/blades" element={<BladesPage />} />
            <Route path="/watch" element={<WatchPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />

            {/* Legacy redirects */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/repowering-pipeline" element={<Navigate to="/retirement" replace />} />
            <Route path="/recovery-value" element={<Navigate to="/materials" replace />} />
            <Route path="/market-monitor" element={<Navigate to="/watch" replace />} />
            <Route path="/workbench" element={<Navigate to="/dci" replace />} />
          </Route>
        </Route>
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
