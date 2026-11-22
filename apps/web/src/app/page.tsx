import { AGENT_SCOPES, APPROVAL_POLICIES } from '@docalaizer/shared';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-8">
        <span className="inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          Stage 0 · Monorepo Skeleton
        </span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Docalaizer</h1>
        <p className="mt-3 max-w-2xl text-neutral-400">
          Confluence / Coda для совместной работы с AI-агентами: дерево документации, диаграммы
          Mermaid, графики Vega-Lite и гарантированная защита ручных правок через Review Inbox.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-medium text-neutral-300">Политики аппрува</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-neutral-400">
            {APPROVAL_POLICIES.map((policy) => (
              <li key={policy} className="font-mono text-neutral-200">
                {policy}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="text-sm font-medium text-neutral-300">Скоупы AI-агентов</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-neutral-400">
            {AGENT_SCOPES.map((scope) => (
              <li key={scope} className="font-mono text-neutral-200">
                {scope}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
