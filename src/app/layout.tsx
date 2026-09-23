import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import './globals.css';

/**
 * Poppins, self-hosted by next/font, so nothing is fetched from Google at runtime and
 * the page never shifts while a face arrives. It is the typeface of the reference site
 * the scale was borrowed from (ENGINEERING-LOG 19), and most of why that site reads as
 * friendly rather than merely large. Three weights: body, emphasis, title.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const DESCRIPTION =
  'Berth reservations for Harborview Marine Research Center. Book a berth, check any date, and never double-book one.';

export const metadata: Metadata = {
  metadataBase: new URL('https://berth-scheduler.vercel.app'),
  title: 'Harborview Dock Schedule',
  description: DESCRIPTION,
  // So the link unfurls with the board when it is pasted somewhere.
  openGraph: {
    title: 'Harborview Dock Schedule',
    description: DESCRIPTION,
    url: '/',
    siteName: 'Harborview Dock Schedule',
    type: 'website',
    images: [{ url: '/board.png', width: 1280, height: 800, alt: 'The dock schedule board' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
