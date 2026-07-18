import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Process capture — Virgin Media O2',
  description:
    'A structured conversational interview that captures how a process really works, in your own words.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        {/* Vendor brand tokens + Aeonik Pro @font-face, served statically from
            /public/brand so its relative font URLs resolve correctly (FR-6.1). */}
        <link rel="stylesheet" href="/brand/colors_and_type.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
