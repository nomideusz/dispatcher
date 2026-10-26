import { ChevronDown, LogOut, RefreshCw } from "lucide-react";
import { Link, NavLink, Outlet, type ShouldRevalidateFunctionArgs, useLocation, useRevalidator } from "react-router";
import { AutoWithdraw } from "~/components/auto-withdraw-dialog";
import { Wordmark } from "~/components/brand";
import { NotificationsDialog } from "~/components/notifications-dialog";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { api } from "~/lib/api";
import { useRefreshAnalytics } from "~/queries/analytics";
import { getApiHealth, getMe, type User } from "~/queries/me";
import type { Route } from "./+types/protected";

export async function clientLoader() {
  const [user, apiUp] = await Promise.all([getMe(), getApiHealth()]);
  return { user, apiUp };
}

// The session and API checks don't depend on the query string: a filter,
// sort or range change shouldn't wait on two round trips. A revalidate()
// (sign-out) keeps the same URL and still runs them.
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
}

export default function Protected({ loaderData }: Route.ComponentProps) {
  if (!loaderData.user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm border bg-popover p-6">
          <CardHeader>
            <CardTitle>
              <Wordmark />
            </CardTitle>
            <CardDescription>
              Kickback, health, and withdrawals for the templates you publish
              on Railway.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loaderData.apiUp ? (
              <Button
                className="w-full"
                nativeButton={false}
                render={<a href="/api/auth/redirect" />}
              >
                Sign in with Railway
              </Button>
            ) : (
              <>
                <p className="text-sm text-destructive">
                  The API isn&apos;t running, so sign-in can&apos;t start.
                </p>
                <p className="text-sm text-muted-foreground">
                  In a second terminal from the repo root, run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    make dev-api
                  </code>{" "}
                  then refresh this page.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }
  return (
    <>
      <a
        href="#content"
        className="sr-only z-30 bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <Header user={loaderData.user} />
      <div id="content" tabIndex={-1} className="outline-none">
        <Outlet context={loaderData.user} />
      </div>
    </>
  );
}

// RefreshButton collects a fresh template snapshot on demand — mainly for a
// first sign-in, when the hourly collector hasn't produced any data yet.
function RefreshButton() {
  const refresh = useRefreshAnalytics();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh data"
      title="Refresh data"
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
    >
      <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
    </Button>
  );
}

const PAGES = [
  ["/", "Money"],
  ["/templates", "Templates"],
  ["/upgrades", "Upgrades"],
  ["/patterns", "Patterns"],
  ["/candidates", "Candidates"],
] as const;

function Header({ user }: { user: User }) {
  const revalidator = useRevalidator();
  // The range rides along between pages.
  const { search } = useLocation();
  const days = new URLSearchParams(search).get("days");

  const signOut = async () => {
    await api.post("auth/logout", { throwHttpErrors: false });
    revalidator.revalidate();
  };

  // Sticky from lg, where it is one 56px row; a phone's two rows would take
  // an eighth of the screen on every scroll.
  return (
    <header className="bar relative z-20 lg:sticky lg:top-0">
      <div className="shell flex flex-wrap items-center gap-x-4 sm:gap-x-10">
        <Link
          to={{ pathname: "/", search: days ? `?days=${days}` : "" }}
          aria-label="Dispatcher, money"
          className="flex h-14 items-center"
        >
          <Wordmark compact />
        </Link>
        <nav
          aria-label="Pages"
          className="flex h-14 gap-5 overflow-x-auto text-sm whitespace-nowrap max-lg:order-last max-lg:h-11 max-lg:w-full sm:gap-7"
        >
          {PAGES.map(([to, label]) => (
            <NavLink
              key={to}
              to={{ pathname: to, search: days ? `?days=${days}` : "" }}
              end
              className="flex items-center border-y-[3px] border-transparent font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-b-current aria-[current=page]:text-foreground"
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center sm:gap-2">
          <RefreshButton />
          <NotificationsDialog />
          <AutoWithdraw />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" aria-label={`Account: ${user.name}`} />}
            >
              {user.avatar && (
                <img src={user.avatar} alt="" className="size-5 rounded-full" />
              )}
              <span className="hidden max-w-32 truncate xl:inline">{user.name}</span>
              <ChevronDown className="text-muted-foreground max-sm:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block text-sm font-medium text-foreground">
                    {user.name}
                  </span>
                  <span className="block font-normal">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
