import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NotificationProvider } from './console/shared/notification-context';
import { ToastContainer } from './console/shared/toast-container';

export const metadata: Metadata = {
  title: 'Remote Console',
  description: 'Remote agent console',
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
        <NotificationProvider>
          {children}
          <ToastContainer />
        </NotificationProvider>
      </body>
    </html>
  );
}
