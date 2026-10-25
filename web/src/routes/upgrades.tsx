import { PageHeader } from "~/components/page";
import { UpgradeQueue } from "~/components/upgrade-queue";
import type { Route } from "./+types/upgrades";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Upgrades · Dispatcher" }];
}

export default function Upgrades() {
  return (
    <main className="viz shell space-y-6 py-6">
      <PageHeader
        title="Upgrades"
        sub="Pinned images and Dockerfile versions against their newest release. Outdated templates first, then by earnings."
      />
      <UpgradeQueue />
    </main>
  );
}
