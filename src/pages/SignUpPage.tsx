import { SignUp } from '@clerk/clerk-react'

const clerkAppearance = {
  variables: {
    colorPrimary:        '#0E7A86',
    colorBackground:     '#FFFFFF',
    colorText:           '#0A1628',
    colorTextSecondary:  '#6B7585',
    colorInputBackground:'#FFFFFF',
    colorInputText:      '#0A1628',
    colorNeutral:        '#D6DBE0',
    colorDanger:         '#C73838',
    colorSuccess:        '#0F8B58',
    borderRadius:        '2px',
    fontFamily:          'Inter, system-ui, sans-serif',
    fontFamilyButtons:   'Inter, system-ui, sans-serif',
  },
  elements: {
    header: { display: 'none' },
    card: {
      boxShadow:  'none',
      border:     '1px solid #D6DBE0',
      borderTop:  '2px solid #0E7A86',
      background: '#FFFFFF',
    },
    formButtonPrimary: { background: '#0E7A86', '&:hover': { background: '#14A4B4' } },
    socialButtonsBlockButton: { background: '#FAFBFC', border: '1px solid #D6DBE0' },
    footerAction: { color: '#6B7585' },
    footerActionLink: { color: '#0E7A86' },
  },
}

export function SignUpPage() {
  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <img src="/logo-dark.png" alt="Endenex" className="h-6 w-auto mx-auto"
             onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <p className="text-[11px] font-bold tracking-[0.18em] text-teal uppercase mt-2">
          ENDENEX·TERMINAL
        </p>
      </div>
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/onboarding"
        appearance={clerkAppearance}
      />
    </div>
  )
}
