"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";

const NAV_LINK_CLASS =
  "rounded-md px-1 py-1 text-neutral-200 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950";

export function Header() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [walletState, setWalletState] = useState<
    "checking" | "connected" | "missing"
  >("checking");

  useEffect(() => {
    const hasWallet =
      Boolean(
        typeof window !== "undefined" &&
          (window as Window & { freighterApi?: unknown }).freighterApi,
      ) ||
      process.env.NODE_ENV !== "production" ||
      process.env.NEXT_PUBLIC_API_MOCK === "true";
    setWalletState(hasWallet ? "connected" : "missing");
  }, []);

  // Restore the user's saved language after hydration. i18n initializes in
  // "en" deterministically on server + client, so applying the stored locale
  // here avoids a hydration mismatch while still persisting the choice.
  useEffect(() => {
    const saved = window.localStorage.getItem("i18nextLng");
    if (saved && saved !== i18n.language) {
      i18n.changeLanguage(saved);
    }
  }, []);

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-neutral-950/80 backdrop-blur-xl">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-indigo-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <nav
        aria-label="Primary navigation"
        role="navigation"
        className="container mx-auto flex items-center justify-between gap-4 px-6 py-4"
      >
        <Link
          href="/"
          aria-label="RustAcademy home"
          className={`flex shrink-0 items-center gap-2 lg:mr-4 ${NAV_LINK_CLASS}`}
        >
          <div
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 font-bold italic"
          >
            Q
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            RustAcademy
          </span>
        </Link>

        <div className="hidden gap-8 text-sm font-medium md:flex">
          <Link
            href="/dashboard"
            aria-current={isActive("/dashboard") ? "page" : undefined}
            className={`${NAV_LINK_CLASS} ${
              isActive("/dashboard") ? "text-white" : ""
            }`}
          >
            {t("dashboard")}
          </Link>
          <Link
            href="/generator"
            aria-current={isActive("/generator") ? "page" : undefined}
            className={`${NAV_LINK_CLASS} ${
              isActive("/generator") ? "text-white" : ""
            }`}
          >
            {t("linkGenerator")}
          </Link>
          <Link
            href="/notifications"
            aria-current={isActive("/notifications") ? "page" : undefined}
            className={`${NAV_LINK_CLASS} ${
              isActive("/notifications") ? "text-white" : ""
            }`}
          >
            Notifications
          </Link>
          <Link
            href="/settings"
            aria-current={isActive("/settings") ? "page" : undefined}
            className={`${NAV_LINK_CLASS} ${
              isActive("/settings") ? "text-white" : ""
            }`}
          >
            {t("profileSettings")}
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <span
            title={
              walletState === "missing"
                ? "No Stellar wallet detected. Install Freighter to pay."
                : undefined
            }
            className={`hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border ${
              walletState === "connected"
                ? "text-emerald-300 border-emerald-400/30 bg-emerald-500/10"
                : "text-neutral-400 border-white/10 bg-white/5"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                walletState === "connected"
                  ? "bg-emerald-400"
                  : "bg-neutral-500"
              }`}
            />
            {walletState === "connected"
              ? "Wallet ready"
              : walletState === "missing"
                ? "No wallet"
                : "…"}
          </span>
          <NotificationBell />
          <LocaleSwitcher />
        </div>
      </nav>
    </header>
  );
}
