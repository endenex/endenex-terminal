import { SignIn } from '@clerk/clerk-react'

const clerkAppearance = {
  variables: {
    colorPrimary: '#007B8A',
    colorBackground: '#1A2E4A',
    colorText: '#FFFFFF',
    colorTextSecondary: '#9CA3AF',
    colorInputBackground: '#0A1628',
    colorInputText: '#FFFFFF',
    borderRadius: '0',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontFamilyButtons: 'Inter, system-ui, sans-serif',
  },
  elements: {
    header: { display: 'none' },
    rootBox: { width: '100%' },
  },
}

export function SignInPage() {
  return (
    <div className="min-h-screen bg-terminal-navy flex flex-col items-center justify-center gap-8">
      <img src="/logo-white.png" alt="Endenex" className="h-8 w-auto" />
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/dashboard"
        appearance={clerkAppearance}
      />
    </div>
  )
}
