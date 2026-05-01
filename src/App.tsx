import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { ClerkProvider, RedirectToSignIn, useAuth } from '@clerk/clerk-react'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { SignInPage } from '@/pages/SignInPage'
import { SignUpPage } from '@/pages/SignUpPage'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) throw new Error('Missing Clerk publishable key')

function RequireAuth() {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded)   return <LoadingScreen />
  if (!isSignedIn) return <RedirectToSignIn />
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
