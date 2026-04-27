import { SignIn } from '@clerk/clerk-react'

const clerkAppearance = {
  variables: {
    colorPrimary: '#007B8A',
    colorBackground: '#FFFFFF',
    colorText: '#0A1628',
    colorTextSecondary: '#6B7280',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#0A1628',
    colorNeutral: '#D1D5DB',
    borderRadius: '0',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontFamilyButtons: 'Inter, system-ui, sans-serif',
  },
  elements: {
    header: { display: 'none' },
    card: {
      boxShadow: 'none',
      border: '1px solid #E5E7EB',
      borderTop: '2px solid #007B8A',
    },
    footerAction: { color: '#6B7280' },
  },
}

export function SignInPage() {
  return (
    <div className="min-h-screen bg-terminal-grey flex flex-col items-center justify-center gap-8">
      <img src="/logo-dark.png" alt="Endenex" className="h-7 w-auto" />
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
