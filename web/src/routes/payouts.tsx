import { PageHeader } from "~/components/page";
import { PayoutHistory } from "~/components/payout-history";
import { RangeToggle, useRangeDays } from "~/components/range-toggle";
import type { Route } from "./+types/payouts";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Payouts · Dispatcher" }];
}

export default function Payouts() {
  const [days, setDays] = useRangeDays();
  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Payouts"
        sub="Money that left Railway as cash or credits, who pays it, and every entry."
      >
        <RangeToggle value={days} onChange={setDays} />
      </PageHeader>
      <PayoutHistory days={days} />
    </main>
  );
}
