'use client';

import { type FormEvent, useState } from 'react';
import { KeyRound, Sun, Moon } from 'lucide-react';
import { ApiClientError, type AuthUser, api } from '@/lib/api';
import { requestLocugardCredential } from '@/lib/webauthn';
import { useTheme } from '../theme-provider';

interface AuthScreenProps {
  locugardEnabled: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({ locugardEnabled, onAuthenticated }: AuthScreenProps) {
  const { theme, toggleTheme } = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({ email, name, password });
      onAuthenticated(res.user);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Не удалось подключиться к API (проверьте, что сервер запущен на :3001).');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLocugardLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const options = await api.getLocugardLoginOptions();
      const credential = await requestLocugardCredential(options.options);
      const result = await api.verifyLocugardLogin({
        challengeId: options.challenge_id,
        credential,
      });
      onAuthenticated(result.user);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Вход по passkey отменён или время ожидания истекло.');
      } else if (err instanceof DOMException && err.name === 'SecurityError') {
        setError('Проверьте HTTPS, RP ID и LOCUGARD_ORIGIN: origin должен совпадать с адресом Docalaizer.');
      } else {
        setError(err instanceof Error ? err.message : 'Не удалось войти через LocuGard.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <button
        type="button"
        onClick={toggleTheme}
        className="fixed right-4 top-4 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-secondary)',
        }}
      >
        {theme === 'dark' ? (
          <Sun className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Moon className="h-4 w-4" strokeWidth={1.75} />
        )}
        {theme === 'dark' ? 'Светлая' : 'Тёмная'}
      </button>

      <div
        className="w-full max-w-sm rounded-xl border p-6"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div className="mb-6 flex items-center gap-2.5">
          <img
            src="/favicon.svg"
            alt="Docalaizer"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Docalaizer</h1>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              AI-native документация с защитой ручных правок
            </p>
          </div>
        </div>

        {locugardEnabled && (
          <div className="mb-4">
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleLocugardLogin()}
              className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-md py-2 text-sm font-medium disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" strokeWidth={1.75} />
              Войти с passkey через LocuGard
            </button>
            <div className="mt-4 flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span className="h-px flex-1" style={{ backgroundColor: 'var(--border-default)' }} />
              или с паролем
              <span className="h-px flex-1" style={{ backgroundColor: 'var(--border-default)' }} />
            </div>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          {mode === 'register' && (
            <div>
              <label
                htmlFor="auth-name"
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--text-secondary)' }}
              >
                Имя
              </label>
              <input
                id="auth-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Пароль
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--sem-danger-bg)',
                borderColor: 'var(--sem-danger-border)',
                color: 'var(--sem-danger-text)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md py-2 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--accent-primary-fg)',
            }}
          >
            {loading ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <div className="mt-4 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
          {mode === 'login' ? (
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className="underline underline-offset-2"
            >
              Зарегистрировать новый аккаунт
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className="underline underline-offset-2"
            >
              Уже есть аккаунт? Войти
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
