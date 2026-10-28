import { PageHeader } from "~/components/page";
import { MarketSearch } from "~/components/search";
import type { Route } from "./+types/search";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Search · Dispatcher" }];
}

export default function SearchPage() {
  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Search"
        sub="Where our templates rank in Railway's marketplace search, which keywords carry demand we miss, and what a position is worth."
      />
      <MarketSearch />
    </main>
  );
}
