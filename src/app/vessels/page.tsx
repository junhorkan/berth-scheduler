import Nav from '../../components/Nav';
import VesselTable from '../../components/VesselTable';
import { getVessels } from '../../db/queries';
import { shareInWords } from '../../lib/share';

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();
  const missing = vessels.filter((v) => v.lengthFt == null);
  const totalBookings = vessels.reduce((a, v) => a + v.bookingCount, 0);
  // The list puts vessels with no length first, busiest first, so its head is where
  // recording a length unlocks the most fit checks.
  const firstTen = missing.slice(0, 10).reduce((a, v) => a + v.bookingCount, 0);
  const share = missing.length > 10 ? shareInWords(firstTen, totalBookings) : null;

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
        {share && <> The first ten account for <b>{share} of the vessel bookings</b>, so start there.</>}
      </>
    );

  return (
    <main className="shell">
      <Nav current="vessels" title="Vessels" tagline={tagline} />
      <VesselTable vessels={vessels} />
    </main>
  );
}
