import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';

/**
 * Poppins, self-hosted by next/font, so nothing is fetched from Google at runtime and
 * the page never shifts while a face arrives. It is the typeface of the reference site
 * the scale was borrowed from (DECISIONS 19), and most of why that site reads as
 * friendly rather than merely large. Three weights: body, emphasis, title.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Harborview Dock Schedule',
  description: 'Berth reservations for Harborview Marine Research Center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
