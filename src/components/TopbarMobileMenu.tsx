import React, { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
}

interface Props {
  links: NavLink[];
  /** Gdy przekazane, drawer renderuje formularz wylogowania (POST na tę akcję). */
  signOutAction?: string;
  /** E-mail zalogowanego użytkownika; gdy brak (gość / konto bez e-maila) — nie renderowany. */
  userEmail?: string;
}

// Mobilny drawer nawigacji (poniżej `sm`). Desktop renderuje linki inline w Topbar.astro.
// Zamknięcie: Escape, wybór linku, klik w tło. Focus wraca na hamburger po zamknięciu.
export default function TopbarMobileMenu({ links, signOutAction, userEmail }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Escape zamyka drawer; Tab jest uwięziony w drawerze (focus-trap), by
  // klawiatura nie uciekła do przyciemnionej treści w tle.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      // Tło (backdrop) ma tabIndex=-1 — wykluczamy je z pętli fokusa.
      const focusables = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([tabindex="-1"])');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Body-scroll-lock: gdy drawer (z przyciemnionym tłem) jest otwarty, tło nie
  // przewija się pod nim — kluczowe na wąskim ekranie 320px.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Po otwarciu przenieś focus do drawera (pierwszy element ostrości).
  useEffect(() => {
    if (open) {
      drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    }
  }, [open]);

  const drawerLink = "tap-target text-link hover:bg-brand-50 rounded-lg px-3 transition-colors hover:text-link-hover";

  return (
    <div className="sm:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls="topbar-mobile-drawer"
        aria-label="Menu nawigacji"
        className="tap-target text-ink-muted hover:text-link-hover justify-center px-2.5"
      >
        <Menu className="size-6" aria-hidden="true" />
      </button>

      {open && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default bg-black/30"
          />
          <div
            id="topbar-mobile-drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu nawigacji"
            className="border-edge fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 border-l bg-white p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              {userEmail ? (
                <span className="text-ink-muted min-w-0 truncate text-sm" title={userEmail}>
                  {userEmail}
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Zamknij menu"
                className="tap-target text-ink-muted hover:text-link-hover shrink-0 justify-center px-2.5"
              >
                <X className="size-6" aria-hidden="true" />
              </button>
            </div>
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={close} className={drawerLink}>
                {link.label}
              </a>
            ))}
            {signOutAction && (
              <form method="POST" action={signOutAction}>
                <button type="submit" className={`${drawerLink} w-full`}>
                  Wyloguj
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
