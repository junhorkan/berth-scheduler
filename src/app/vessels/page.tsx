import Nav from '../../components/Nav';
import VesselTable from '../../components/VesselTable';
import { getVessels } from '../../db/queries';
import { shareInWords } from '../../lib/share';

/**
 * Rows the register shows per category before the rest folds away. It lives here
 * because the line under the page's name counts exactly those rows: a page that claims
 * one number and displays another is worse than one that says nothing.
 */
const HEAD = 5;
/** Small numbers read better as words in a sentence. */
const NUMBER: Record<number, string> = { 3: 'three', 4: 'four', 5: 'five', 6: 'six', 10: 'ten' };

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();
  const missing = vessels.filter((v) => v.lengthFt == null);
  const totalBookings = vessels.reduce((a, v) => a + v.bookingCount, 0);
  // The list puts vessels with no length first, busiest first, so its head is where
  // recording a length unlocks the most fit checks. The line below counts exactly the
  // rows the register shows, so the page cannot claim one number and display another.
  const headBookings = missing.slice(0, HEAD).reduce((a, v) => a + v.bookingCount, 0);
  const share = missing.length > HEAD ? shareInWords(headBookings, totalBookings) : null;

  /**
   * One line under the page's name: what is missing, and where to start. It used to be
   * four figures in a sentence (398 of 418, 1,920 of 1,974, 1,002), which the reader had
   * to do arithmetic on before it said anything. The counts are in the table; the line
   * says the one proportion that matters, in words (lib/share).
   */
  const tagline =
    vessels.length === 0 ? (
      'No vessels yet. Booking one registers it here, and its length can be recorded after.'
    ) : missing.length === 0 ? (
      'Every vessel has a length on record.'
    ) : (
      <>
        {missing.length * 2 > vessels.length
          ? 'Most have no length on record.'
          : missing.length === 1
            ? 'One has no length on record yet.'
            : 'Some have no length on record yet.'}
        {share && <> The first {NUMBER[HEAD] ?? HEAD} account for{' '}
          <b>{share} of the vessel bookings</b>, so start there.</>}
      </>
    );

  return (
    <main className="shell">
      <Nav current="vessels" title="Vessels" tagline={tagline} />
      <VesselTable vessels={vessels} head={HEAD} />
    </main>
  );
}
