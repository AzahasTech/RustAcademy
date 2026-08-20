import {
  AVAILABLE_SCOPES,
  type ApiKeyScope,
  type NewKeyForm,
} from "@/app/settings/developer/api-key-types";
import React from "react";
import { useEffect, useRef } from "react";

type Props = {
  setModalOpen: (state: boolean) => void;
  newKey: NewKeyForm;
  setNewKey: React.Dispatch<React.SetStateAction<NewKeyForm>>;
  generateKey: () => void;
  loading: boolean;
};

const SCOPE_LABELS: Record<ApiKeyScope, { label: string; description: string }> = {
  "links:read":       { label: "links:read",       description: "Fetch and query payment links" },
  "links:write":      { label: "links:write",       description: "Create and update payment links" },
  "transactions:read":{ label: "transactions:read", description: "Read transaction history" },
  "usernames:read":   { label: "usernames:read",    description: "Look up registered usernames" },
};

export default function CreateAPIKeyModal({
  setModalOpen,
  newKey,
  setNewKey,
  generateKey,
  loading,
}: Props) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    closeButtonRef.current?.focus();

    return () => previousFocusRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !loading) {
      event.preventDefault();
      setModalOpen(false);
      return;
    }
    if (event.key !== "Tab" || !modalRef.current) return;
    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])"
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setNewKey((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-api-key-title"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !loading && setModalOpen(false)}
        aria-hidden="true"
      />

      {/* Modal */}
      <div ref={modalRef} className="relative w-full max-w-md bg-neutral-900 border border-white/10 rounded-3xl p-8 shadow-2xl space-y-6">
        <h3 id="create-api-key-title" className="text-xl font-black">Create New API Key</h3>

        {/* Key name */}
        <div className="space-y-2">
          <label htmlFor="api-key-name" className="text-xs font-black uppercase tracking-widest text-neutral-500">
            Key Name
          </label>
          <input
            id="api-key-name"
            type="text"
            placeholder="e.g. Production App"
            value={newKey.name}
            onChange={(e) =>
              setNewKey((prev) => ({ ...prev, name: e.target.value }))
            }
            className="w-full bg-neutral-800 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-semibold focus:outline-none focus:border-indigo-500/60 focus-visible:ring-2 focus-visible:ring-indigo-300 placeholder:text-neutral-600"
          />
        </div>

        {/* Scope selection */}
        <div className="space-y-2">
          <div id="api-key-scopes-label" className="text-xs font-black uppercase tracking-widest text-neutral-500">
            Scopes
          </div>
          <div className="space-y-2">
            {AVAILABLE_SCOPES.map((scope) => {
              const active = newKey.scopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  aria-pressed={active}
                  aria-label={`${SCOPE_LABELS[scope].label}: ${SCOPE_LABELS[scope].description}`}
                  className={`w-full p-3 rounded-xl border text-left transition flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 ${
                    active
                      ? "border-indigo-500/40 bg-indigo-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${
                      active
                        ? "border-indigo-500 bg-indigo-500 text-white"
                        : "border-white/20"
                    }`}
                  >
                    {active && "✓"}
                  </div>
                  <div>
                    <div className={`text-xs font-bold font-mono ${active ? "text-indigo-300" : "text-neutral-400"}`}>
                      {SCOPE_LABELS[scope].label}
                    </div>
                    <div className="text-xs text-neutral-600 mt-0.5">
                      {SCOPE_LABELS[scope].description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setModalOpen(false)}
            disabled={loading}
            className="flex-1 py-3 rounded-xl border border-white/10 text-sm font-semibold text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={generateKey}
            disabled={!newKey.name.trim() || newKey.scopes.length === 0 || loading}
            className="flex-1 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          >
            {loading ? "Creating…" : "Generate Key"}
          </button>
        </div>
      </div>
    </div>
  );
}
