import { SignIn } from '@clerk/clerk-react'

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

export function SignInPage() {
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
            Market intelligence<br />for ageing clean energy assets
          </h2>
          <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
            Independent benchmark data for decommissioning costs, repowering activity,
            and recoverable material flows across European and US onshore wind markets.
          </p>
        </div>
        <div className="text-gray-600 text-xs font-mono">terminal.endenex.com</div>
      </div>

      {/* Auth panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <SignIn
          routing="path"
          path="/sign-in"
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
          appearance={clerkAppearance}
        />
      </div>
    </div>
  )
}
