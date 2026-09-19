import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Harborview Dock Schedule',
  description: 'Berth reservations for Harborview Marine Research Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
