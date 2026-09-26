import { NavLink, Outlet } from "react-router-dom";
import type { ReactNode } from "react";

const TABS: { to: string; label: string; icon: ReactNode }[] = [
  {
    to: "/",
    label: "Today",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    to: "/workout",
    label: "Workout",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <path d="M6 4v16M10 6v12M14 5v14M18 4v16" />
      </svg>
    ),
  },
  {
    to: "/history",
    label: "History",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
      </svg>
    ),
  },
  {
    to: "/coach",
    label: "Coach",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      </svg>
    ),
  },
  {
    to: "/profile",
    label: "Profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
      </svg>
    ),
  },
];

export default function Layout() {
  return (
    <div className="max-w-[420px] mx-auto bg-bg min-h-screen flex flex-col">
      <header className="px-4 py-3 flex items-center justify-between">
        <div className="font-serif font-light text-xl">
          activate<span className="text-accent font-medium">Myo</span>
        </div>
      </header>

      <main className="flex-grow overflow-y-auto p-4">
        <Outlet />
      </main>

      <nav className="flex justify-around border-t border-track py-2.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 text-[10.5px] py-2 ${
                isActive ? "text-ink" : "text-muted"
              }`
            }
          >
            <span className="w-5 h-5">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
