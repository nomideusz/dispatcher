import { redirect } from "react-router";
import type { Route } from "./+types/payouts";

// Payouts is a section of Money now; old links land on it.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return redirect(`/${new URL(request.url).search}#payouts`);
}

export default function Payouts() {
  return null;
}
