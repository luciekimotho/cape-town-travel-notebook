import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { errorMessage } from '../errorMessage'
import { requestSignIn, signInWithPassword, verifySignInCode, verifySignInLink } from './auth'

export function EmailSignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [signInMethod, setSignInMethod] = useState<'password' | 'email'>('password')
  const [password, setPassword] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [credential, setCredential] = useState('')
  const [method, setMethod] = useState<'code' | 'link'>('code')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const inFlight = useRef(false)
  useEffect(() => {
    if (!resendAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [resendAt])
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => () => setPassword(''), [])
  const passwordSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setError('')
    const submitted = password
    setPassword('')
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet to sign in.')
      onSignedIn(await signInWithPassword(email, submitted))
    } catch (error) {
      setError(errorMessage(error, 'Sign-in failed. Check your details or use email code/link.'))
    } finally { inFlight.current = false; setBusy(false) }
  }
  const request = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (inFlight.current || Date.now() < resendAt) return
    inFlight.current = true
    setBusy(true); setError('')
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet to request a sign-in email.')
      const target = sentTo || email.trim().toLowerCase()
      await requestSignIn(target)
      setSentTo(target); setCredential('')
      setResendAt(Date.now() + 60_000); setNow(Date.now())
    } catch (error) {
      setError(errorMessage(error, 'The email could not be sent. Please try again.'))
    } finally { inFlight.current = false; setBusy(false) }
  }
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setError('')
    const value = credential
    setCredential('')
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet to finish signing in.')
      const session = method === 'code'
        ? await verifySignInCode(sentTo, value)
        : await verifySignInLink(value)
      onSignedIn(session)
    } catch (error) {
      setError(errorMessage(error, 'Sign-in failed. Request a fresh email if the code or link has expired.'))
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="email-sign-in">
    {!sentTo && <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
      <button type="button" role="tab" aria-selected={signInMethod === 'password'} onClick={() => { setSignInMethod('password'); setPassword(''); setError('') }}>Password</button>
      <button type="button" role="tab" aria-selected={signInMethod === 'email'} onClick={() => { setSignInMethod('email'); setPassword(''); setError('') }}>Email code / link</button>
    </div>}
    {!sentTo && signInMethod === 'password' ? <form className="cloud-entry-form" onSubmit={passwordSignIn}>
      <label className="field">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></label>
      <label className="field">Password<input name="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/></label>
      <button className="save" disabled={busy}>{busy ? 'Signing in…' : 'Sign in with password'}</button>
      <p className="auth-instructions">First time here, or forgot your password? Use <button className="inline-auth-action" type="button" onClick={() => { setSignInMethod('email'); setPassword(''); setError('') }}>Email code / link</button>, then set a new password in Settings.</p>
    </form> : !sentTo ? <form className="cloud-entry-form" onSubmit={request}>
      <label className="field">Email<input name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></label>
      <button className="save" disabled={busy || remaining > 0}>{busy ? 'Sending…' : remaining ? `Try again in ${remaining}s` : 'Email me a sign-in code'}</button>
      <button className="text-action" type="button" disabled={busy} onClick={event => {
        if (event.currentTarget.form?.reportValidity()) { setSentTo(email.trim().toLowerCase()); setError('') }
      }}>I already have a code or link</button>
    </form> : <>
      <p className="auth-instructions" role="status">Use the email for <strong>{sentTo}</strong>. Return to this app to finish signing in.</p>
      <form className="cloud-entry-form" onSubmit={verify}>
        {method === 'code' ? <label className="field">Email code<input key="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} pattern={'[0-9\\s]{6,20}'} maxLength={20} required value={credential} onChange={event => setCredential(event.target.value)} disabled={busy}/></label> :
          <label className="field">Sign-in link<textarea key="link" name="signInLink" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={credential} onChange={event => setCredential(event.target.value)} disabled={busy}/></label>}
        <button className="save" disabled={busy}>{busy ? 'Signing in…' : 'Sign in here'}</button>
      </form>
      <button className="text-action auth-method" type="button" disabled={busy} onClick={() => { setMethod(method === 'code' ? 'link' : 'code'); setCredential(''); setError('') }}>
        {method === 'code' ? 'My email only has a sign-in link' : 'Use an email code instead'}
      </button>
      {method === 'link' && <p className="auth-instructions">In your email, press and hold the sign-in link and choose Copy Link. Paste it above without opening it. This signs in this app, not Safari. Never share the link.</p>}
      <div className="auth-email-actions">
        <button className="text-action" type="button" disabled={busy || remaining > 0} onClick={() => void request()}>{remaining ? `Resend in ${remaining}s` : 'Resend email'}</button>
        <button className="text-action" type="button" disabled={busy} onClick={() => { setSentTo(''); setCredential(''); setError('') }}>Change email</button>
      </div>
    </>}
    {error && <p className="error auth-error" role="alert">{error}</p>}
  </div>
}
