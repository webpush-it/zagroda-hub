import React, { useEffect, useRef, useState } from "react";
import { User, ChevronDown, LogOut } from "lucide-react";

interface Props {
  /** E-mail zalogowanego użytkownika; gdy brak (konto OAuth bez e-maila) — nie renderowany, ale menu działa. */
  userEmail?: string;
  /** Akcja wylogowania (POST). Wyspa montowana tylko dla zalogowanych, więc jest wymagana. */
  signOutAction: string;
}

// Desktopowe (≥sm) menu konta zastępujące inline e-mail. Kompaktowy trigger (ikona osoby
// + chevron) o stałej szerokości — nigdy nie truncatuje. Lekki dropdown (bez tła modalnego,
// bez blokady scrolla, bez focus-trapa): Escape i klik poza zamykają, focus wraca na trigger.
// Wzorzec disclosure: aria-haspopup + aria-expanded. Poniżej `sm` menu daje drawer (TopbarMobileMenu).
export default function AccountMenu({ userEmail, signOutAction }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Escape zamyka; klik poza wrapperem (trigger + popover) zamyka. Oba nasłuchy tylko gdy otwarte.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu-popover"
        aria-label={userEmail ? `Menu konta: ${userEmail}` : "Menu konta"}
        className="tap-target text-ink-muted hover:text-link-hover flex items-center gap-1 px-2.5"
      >
        <User className="size-5" aria-hidden="true" />
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="account-menu-popover"
          className="border-edge absolute top-full right-0 z-50 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border bg-white p-2 shadow-xl"
        >
          {userEmail && (
            <span className="text-ink-muted px-3 py-1 text-sm break-all" title={userEmail}>
              {userEmail}
            </span>
          )}
          <form method="POST" action={signOutAction}>
            <button
              type="submit"
              className="tap-target text-link hover:bg-brand-50 hover:text-link-hover flex w-full items-center gap-2 rounded-lg px-3 transition-colors"
            >
              <LogOut className="size-4" aria-hidden="true" />
              Wyloguj
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
