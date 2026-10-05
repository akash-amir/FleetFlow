import Link from 'next/link';

// Placeholder links — only Dashboard has a page behind it so far; the rest
// get built out module by module.
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/customers', label: 'Customers' },
  { href: '/orders', label: 'Orders' },
  { href: '/shipments', label: 'Shipments' },
  { href: '/invoices', label: 'Invoices' },
];

export function SideNav() {
  return (
    <nav className="w-48 shrink-0 border-r border-gray-200 p-4">
      <ul className="space-y-1">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
