import { PageHeader, Section } from "~/components/page";
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
        sub="Pinned images and Dockerfile versions against their newest release"
      />
      <Section
        id="queue"
        title="Queue"
        text="Urgent first: an upgrade that fixes a security hole or something our version breaks on, most running instances first, since every deploy is exposed, paying or not. Then the rest behind on their line, the most-earning first; those that earned nothing wait under the table. Majors and every template are a filter away."
      >
        <UpgradeQueue />
      </Section>
    </main>
  );
}
