import { useEffect, useState } from 'react';
import { authClient } from '@/auth/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { m } from '@/locale/paraglide/messages';

const RESEND_COOLDOWN_SECONDS = 60;

export function ResendVerificationButton({
  email,
  callbackUrl,
  initialMessage,
}: {
  email: string;
  callbackUrl: string;
  initialMessage: string;
}) {
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((seconds) => seconds - 1),
      1_000
    );
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setPending(true);
    setResult(null);
    try {
      const response = await authClient.sendVerificationEmail({
        email,
        callbackURL: callbackUrl,
      });
      setResult(response.error ? 'error' : 'success');
      if (!response.error) setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setResult('error');
    } finally {
      setPending(false);
    }
  }

  const message =
    result === 'error'
      ? m.auth_verification_send_failed()
      : result === 'success'
        ? m.auth_verification_requested()
        : initialMessage;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2.5 text-sm">
      <p
        role={result === 'error' ? 'alert' : 'status'}
        className={cn(
          'text-muted-foreground',
          result === 'error' && 'text-destructive'
        )}
      >
        {message}
      </p>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm font-medium"
        data-testid="auth-resend-verification"
        disabled={pending || cooldown > 0 || !email}
        onClick={resend}
      >
        {pending
          ? m.auth_verification_sending()
          : cooldown > 0
            ? m.auth_verification_cooldown({ seconds: cooldown })
            : m.auth_verification_resend()}
      </Button>
    </div>
  );
}
