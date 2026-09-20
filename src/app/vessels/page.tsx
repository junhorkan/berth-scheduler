import Nav from '../../components/Nav';
import VesselTable from '../../components/VesselTable';
import { getVessels } from '../../db/queries';

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();
  const missing = vessels.filter((v) => v.lengthFt == null);
  const totalBookings = vessels.reduce((a, v) => a + v.bookingCount, 0);
  const blocked = missing.reduce((a, v) => a + v.bookingCount, 0);
  const recorded = vessels.length - missing.length;
  // What the next ten rows are worth — the argument for the ordering, made once.
  const nextTen = missing.slice(0, 10).reduce((a, v) => a + v.bookingCount, 0);

  return (
    <main className="shell">
      <Nav current="vessels" />

      {/*
        One sentence, not the three paragraphs this used to carry. The old second
        paragraph explained why the list is sorted by bookings blocked; the sort is
        evident from the column, and a page that has to explain its own ordering is
        usually just sorted wrong.
      */}
      <p className="pagelede">
        <b>{missing.length} of {vessels.length} vessels have no length on record</b>, so{' '}
        {blocked.toLocaleString()} of {totalBookings.toLocaleString()} bookings cannot be
        fit-checked.
        {nextTen > 0 && (
          <> The ten rows below cover <b>{nextTen.toLocaleString()}</b> of them.</>
        )}
      </p>

      {recorded > 0 && (
        <p className="pagemeta">{recorded} recorded so far.</p>
      )}

      <VesselTable vessels={vessels} />
    </main>
  );
}
