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
      <body>{children}</body>
    </html>
  );
}
