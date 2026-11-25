import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Factory OS — ERP', description: 'ระบบ ERP สำหรับโรงงาน' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1,
  // edge to edge on phones: the bottom navigator pads itself by the home-bar inset (env(safe-area-inset-bottom))
  viewportFit: 'cover',
  // light for everyone (globals.css does not follow the OS dark preference)
  themeColor: '#EEF1F9',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
