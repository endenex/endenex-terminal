import { SignUp } from '@clerk/clerk-react'

const clerkAppearance = {
  variables: {
    colorPrimary: '#007B8A',
    colorBackground: '#1A2E4A',
    colorText: '#FFFFFF',
    colorTextSecondary: '#9CA3AF',
    colorInputBackground: '#0A1628',
    colorInputText: '#FFFFFF',
    borderRadius: '0.375rem',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontFamilyButtons: 'Inter, system-ui, sans-serif',
  },
}

export function SignUpPage() {
  return (
    <div className="min-h-screen bg-terminal-navy flex">
      {/* Branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[45%] p-12 border-r border-terminal-navy-border">
        <div>
          <div className="text-terminal-teal font-mono text-[11px] tracking-[0.2em]">ENDENEX</div>
          <div className="text-gray-500 font-mono text-[11px] tracking-[0.2em] mt-0.5">TERMINAL</div>
        </div>
        <div>
          <h2 className="text-white text-2xl font-semibold leading-snug mb-4">
            Request access to<br />Endenex Terminal
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
            Professional intelligence for institutional market participants —
            fund managers, lenders, developers, contractors, and recyclers.
          </p>
        </div>
        <div className="text-gray-600 text-xs font-mono">terminal.endenex.com</div>
      </div>

      {/* Auth panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <SignUp
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/onboarding"
          appearance={clerkAppearance}
        />
      </div>
    </div>
  )
}
