"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Team Pulse", abbr: "TP" },
  { href: "/roster", label: "Roster", abbr: "RO" },
  { href: "/trends", label: "Trends", abbr: "TR" },
  { href: "/stack-rank", label: "Stack Rank", abbr: "SR" },
  { href: "/coach", label: "Ask Coach", abbr: "AC" },
  { href: "/placement", label: "Placement", abbr: "PL" },
  // Agents see these scoped to themselves (server-enforced in the pages):
  // Commission = own rows; Film Room = /film redirects agents to their own library.
  { href: "/commission", label: "Commission", abbr: "CM" },
  { href: "/film", label: "Film Room", abbr: "FR" },
  // Manager-only: costs, spend, and admin.
  { href: "/close", label: "Close Diagnostics", abbr: "CD", managerOnly: true },
  { href: "/mailer", label: "Mailer", abbr: "MA", managerOnly: true },
  { href: "/health", label: "Data Health", abbr: "DH", managerOnly: true },
];

export default function Nav({
  role,
  myCardHref,
}: {
  role: "manager" | "agent";
  myCardHref: string | null;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const links = [
    ...LINKS.filter((l) => role === "manager" || !l.managerOnly),
    ...(role === "agent" && myCardHref
      ? [{ href: myCardHref, label: "My Card", abbr: "ME" }]
      : []),
  ];

  return (
    <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`display whitespace-nowrap rounded-sm border px-3 py-2 text-sm uppercase tracking-wider transition-colors ${
            isActive(l.href)
              ? "border-gold-dim bg-navy text-gold"
              : "border-transparent text-mute hover:border-edge hover:text-ink"
          }`}
        >
          <span className="lg:hidden">{l.abbr}</span>
          <span className="hidden lg:inline">{l.label}</span>
        </Link>
      ))}
    </nav>
  );
}
