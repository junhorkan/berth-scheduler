import Nav from '../../components/Nav';
import VesselTable from '../../components/VesselTable';
import { getVessels } from '../../db/queries';

/** Rows per page in the register. The table pages; nothing else depends on the number. */
const PER_PAGE = 10;

export const dynamic = 'force-dynamic';

export default async function VesselsPage() {
  const vessels = await getVessels();

  return (
    <main className="shell">
      {/*
        One line saying what the page is for, the shape every other masthead uses.

        It used to report state and then do arithmetic on it: "Most have no length on
        record. The first ten account for half of the vessel bookings, so start
        there." Every figure in it was true and computed, and it still asked the reader
        to hold a proportion in their head before the page had told them what it was.

        Each of those two jobs is already done better below. The split is named on its
        own button — "No length on record" — and counted by the pager; the ordering puts
        the hulls whose missing length blocks the most bookings first, and each row says
        how many bookings that is. The line stops repeating them (DECISIONS 9).
      */}
      <Nav
        current="vessels"
        title="Vessels"
        tagline="Every vessel on the schedule, and how long each one is."
      />
      <VesselTable vessels={vessels} perPage={PER_PAGE} />
    </main>
  );
}
