import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SessionBridge — Claude Code Remote Shell',
  description: 'Remote terminal bridge for Claude Code sessions',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0d1117',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full font-mono text-sm text-[#e6edf3] antialiased">
        {children}
      </body>
    </html>
  );
}
