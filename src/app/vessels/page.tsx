import Nav from '../../components/Nav';
import VesselTable from '../../components/VesselTable';
import { getVessels } from '../../db/queries';

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();
  const missing = vessels.filter((v) => v.lengthFt == null);
  const totalBookings = vessels.reduce((a, v) => a + v.bookingCount, 0);
  const blocked = missing.reduce((a, v) => a + v.bookingCount, 0);
  // What the next ten rows are worth — the argument for the ordering, made once.
  const nextTen = missing.slice(0, 10).reduce((a, v) => a + v.bookingCount, 0);

  /**
   * One line under the page's name, and it is the page's whole argument: how much of
   * the schedule cannot be checked, and how little work closes most of the gap. The
   * sort order is not explained — the Bookings column, descending, says it — and the
   * count of recorded lengths is not stated, because it is the difference of the two
   * numbers already on the line.
   */
  const tagline =
    vessels.length === 0 ? (
      'No vessels yet. Booking one registers it here, and its length can be recorded after.'
    ) : missing.length === 0 ? (
      <>Every one of the {vessels.length} vessels has a length on record.</>
    ) : (
      <>
        <b>{missing.length} of {vessels.length} vessels have no length on record</b>, so{' '}
        {blocked.toLocaleString()} of {totalBookings.toLocaleString()} bookings cannot be
        fit-checked.
        {nextTen > 0 && (
          <> The ten rows below cover <b>{nextTen.toLocaleString()}</b> of them.</>
        )}
      </>
    );

  return (
    <main className="shell">
      <Nav current="vessels" title="Vessels" tagline={tagline} />
      <VesselTable vessels={vessels} />
    </main>
  );
}
