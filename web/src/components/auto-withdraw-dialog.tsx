import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { fmtCents } from "~/lib/format";
import { cn } from "~/lib/utils";
import {
  accountLabel,
  accountReady,
  saveWithdrawSettings,
  SCHEDULE_PRESETS,
  scheduleDescription,
  fmtRun,
  type WithdrawAccounts,
  type WithdrawAttempt,
  withdrawAccountsQuery,
  withdrawNextQuery,
  type WithdrawSettings,
  withdrawSettingsQuery,
} from "~/queries/withdraw";

/**
 * AutoWithdraw is a header button that opens the auto-withdraw setup dialog:
 * pick a payout account, choose how often it runs, and turn it on or off.
 * Nothing changes until Save; Cancel always leaves things as they were.
 * `inline` renders the trigger as a text link, for use inside a sentence.
 */
export function AutoWithdraw({ inline = false }: { inline?: boolean }) {
  const qc = useQueryClient();
  const settings = useQuery(withdrawSettingsQuery);
  const [open, setOpen] = useState(false);
  // What the last save stored, shown as the confirmation until the dialog
  // closes.
  const [saved, setSaved] = useState<(WithdrawSettings & { attempt?: WithdrawAttempt }) | null>(
    null,
  );

  const save = useMutation({
    mutationFn: saveWithdrawSettings,
    onSuccess: (data) => {
      qc.setQueryData(withdrawSettingsQuery.queryKey, data);
      // Turning it on tries a withdrawal right away, so the balance moves.
      qc.invalidateQueries({ queryKey: withdrawAccountsQuery.queryKey });
      setSaved(data);
    },
  });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSaved(null);
      save.reset();
    }
  };

  if (!settings.data) return null;
  const { enabled, withdrawalAccountId, schedule } = settings.data;

  return (
    <>
      {inline ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-primary underline underline-offset-2 outline-none hover:decoration-2 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {enabled ? "Change" : "Set up auto-withdraw"}
        </button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Banknote className="sm:hidden" />
          <span className="sr-only sm:not-sr-only">
            {enabled
              ? `Auto-withdraw · ${SCHEDULE_PRESETS.find((p) => p.spec === schedule)?.label ?? "Custom"}`
              : "Auto-withdraw"}
          </span>
        </Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          {saved ? (
            <SavedView saved={saved} onDone={() => onOpenChange(false)} />
          ) : (
            <SetupView
              enabled={enabled}
              currentAccountId={withdrawalAccountId}
              currentSchedule={schedule}
              pending={save.isPending}
              error={save.error}
              onSave={save.mutate}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SavedView({
  saved,
  onDone,
}: {
  saved: WithdrawSettings & { attempt?: WithdrawAttempt };
  onDone: () => void;
}) {
  const next = useQuery({ ...withdrawNextQuery(saved.schedule), enabled: saved.enabled });
  const { sentCents, skipped } = saved.attempt ?? {};
  return (
    <>
      <DialogHeader>
        <DialogTitle>{saved.enabled ? "Auto-withdraw is on" : "Auto-withdraw is off"}</DialogTitle>
        <DialogDescription role="status">
          {saved.enabled
            ? `Saved. It runs ${scheduleDescription(saved.schedule)}${
                next.data?.[0] ? `; next on ${fmtRun(next.data[0])}` : ""
              }. ${
                sentCents
                  ? `Withdrawal of ${fmtCents(sentCents)} requested just now; it shows on Payouts as pending.`
                  : skipped
                    ? `Nothing was withdrawn just now: ${skipped}.`
                    : ""
              }`
            : "Saved. Nothing will be withdrawn automatically until you turn it back on."}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onDone} autoFocus>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function SetupView({
  enabled,
  currentAccountId,
  currentSchedule,
  pending,
  error,
  onSave,
  onCancel,
}: {
  enabled: boolean;
  currentAccountId: string;
  currentSchedule: string;
  pending: boolean;
  error: Error | null;
  onSave: (body: {
    enabled: boolean;
    withdrawalAccountId?: string;
    schedule?: string;
  }) => void;
  onCancel: () => void;
}) {
  const accounts = useQuery(withdrawAccountsQuery);
  // Opening the dialog is how you turn it on, so the switch starts on; when
  // it is already on, switching off only takes effect on Save.
  const [on, setOn] = useState(true);
  const [picked, setPicked] = useState(currentAccountId);
  // Default to the first usable account (banks sort first) until the user picks.
  const selected = picked || accounts.data?.accounts.find(accountReady)?.id || "";
  const account = accounts.data?.accounts.find((a) => a.id === selected);

  // A stored schedule that isn't one of the presets was hand-written, so open
  // straight into the cron editor with it.
  const [custom, setCustom] = useState(
    !SCHEDULE_PRESETS.some((p) => p.spec === currentSchedule),
  );
  const [spec, setSpec] = useState(currentSchedule);
  const next = useQuery({ ...withdrawNextQuery(spec.trim()), enabled: on && spec.trim() !== "" });
  const specError = next.isError && "invalid" in next.error && next.error.invalid ? next.error.message : null;
  const previewDown = next.isError && !specError;

  const changed = on !== enabled || (on && (selected !== currentAccountId || spec.trim() !== currentSchedule));
  const canSave =
    changed && !pending && (!on || (selected !== "" && spec.trim() !== "" && !specError));

  // Accounts loaded but none can receive money yet: saving can't work.
  const noAccount = accounts.isSuccess && !accounts.data.accounts.some(accountReady);

  const balance = accounts.data?.availableBalance;
  const minimum = accounts.data?.minimumBalance;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Auto-withdraw</DialogTitle>
        <DialogDescription>
          Sends your Railway balance to the account you choose, on a schedule, whenever it is over the
          minimum
          {minimum != null ? ` of ${fmtCents(minimum)}` : ""}.
        </DialogDescription>
      </DialogHeader>

      <label className="flex cursor-pointer items-center justify-between gap-3 border p-3">
        <span className="text-sm font-medium">Withdraw automatically</span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="size-5 cursor-pointer"
        />
      </label>

      {on && (
        <>
          <AccountList query={accounts} selected={selected} onSelect={setPicked} />

          <div className="grid gap-2">
            <span id="frequency-label" className="text-sm font-medium">
              Frequency
            </span>
            <div
              role="radiogroup"
              aria-labelledby="frequency-label"
              className="grid grid-cols-4 gap-1 border p-1"
            >
              {[...SCHEDULE_PRESETS, { spec: "", label: "Custom" }].map((p) => {
                const isCustom = p.spec === "";
                const active = isCustom ? custom : !custom && spec === p.spec;
                return (
                  <label
                    key={p.label}
                    className={cn(
                      "flex h-8 cursor-pointer items-center justify-center px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring pointer-coarse:h-10",
                      active
                        ? "bg-secondary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="frequency"
                      className="sr-only"
                      checked={active}
                      onChange={() => {
                        setCustom(isCustom);
                        if (!isCustom) setSpec(p.spec);
                      }}
                    />
                    {p.label}
                  </label>
                );
              })}
            </div>
            {custom && (
              <>
                <input
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder="0 8 * * *"
                  spellCheck={false}
                  aria-label="Cron schedule"
                  aria-invalid={specError ? true : undefined}
                  aria-describedby="cron-help"
                  className="h-9 border border-input bg-transparent px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive sm:text-sm"
                />
                <p id="cron-help" className="text-xs text-muted-foreground">
                  Cron format in UTC: minute, hour, day of month, month, day of
                  week — e.g. <code>0 8 * * 5</code> is Fridays at 08:00.
                </p>
              </>
            )}
          </div>
        </>
      )}

      <p aria-live="polite" className="border-t pt-3 text-sm">
        {!on ? (
          enabled ? (
            "Saving turns auto-withdraw off. Nothing is withdrawn until you turn it back on."
          ) : (
            "Auto-withdraw stays off."
          )
        ) : noAccount ? (
          <span className="text-destructive">
            No account can receive money yet. Finish its setup in{" "}
            <a
              href="https://railway.com/workspace/earn"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Railway earnings settings
            </a>
            , then come back.
          </span>
        ) : specError ? (
          <span className="text-destructive">{specError}</span>
        ) : previewDown ? (
          <span className="text-muted-foreground">
            Couldn&apos;t preview the next run right now. You can still save; the schedule is checked
            when it is saved.
          </span>
        ) : next.data && next.data.length === 0 ? (
          <span className="text-destructive">This schedule never runs.</span>
        ) : (
          <>
            {next.data?.[0] ? (
              <>
                Next run <strong className="font-semibold">{fmtRun(next.data[0])}</strong>
              </>
            ) : (
              "Checking the schedule…"
            )}
            {balance != null && minimum != null && (
              <>
                {" "}
                ·{" "}
                {/* Mirrors runAutoWithdraw: strictly over the minimum, sent
                    in whole $5 steps. */}
                {balance > minimum
                  ? `${fmtCents(Math.floor(balance / 500) * 500)} of ${fmtCents(balance)} to ${account ? accountLabel(account) : "the chosen account"} (whole $5 steps)`
                  : `skipped unless the balance (now ${fmtCents(balance)}) is over ${fmtCents(minimum)}`}
              </>
            )}
            {!enabled && balance != null && minimum != null && balance > minimum && (
              <>. Turning it on also tries a withdrawal right away.</>
            )}
          </>
        )}
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}

      <DialogFooter className="items-center">
        {on && !changed && (
          <span className="mr-auto text-xs text-muted-foreground">Nothing changed yet.</span>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant={enabled && !on ? "destructive" : "default"}
          onClick={() =>
            onSave(
              on
                ? { enabled: true, withdrawalAccountId: selected, schedule: spec.trim() }
                : { enabled: false },
            )
          }
          disabled={!canSave}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {!enabled ? "Turn on auto-withdraw" : on ? "Save changes" : "Turn off auto-withdraw"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AccountList({
  query,
  selected,
  onSelect,
}: {
  query: ReturnType<typeof useQuery<WithdrawAccounts>>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load your withdrawal accounts.
      </p>
    );
  }
  if (!query.data || query.data.accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No withdrawal accounts yet. Add one in your{" "}
        <a
          href="https://railway.com/workspace/earn"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Railway earnings settings
        </a>
        , then come back.
      </p>
    );
  }

  return (
    <div role="radiogroup" aria-label="Withdrawal account" className="grid gap-2">
      {query.data.accounts.map((a) => {
        const usable = accountReady(a);
        const checked = selected === a.id;
        return (
          <label
            key={a.id}
            className={cn(
              "flex items-center gap-3 border p-3 has-focus-visible:ring-2 has-focus-visible:ring-ring",
              usable ? "cursor-pointer hover:bg-muted/50" : "opacity-60",
              checked && "border-primary",
            )}
          >
            <input
              type="radio"
              name="withdrawal-account"
              className="sr-only"
              checked={checked}
              disabled={!usable}
              onChange={() => onSelect(a.id)}
            />
            <span
              aria-hidden
              className={cn(
                "size-4 shrink-0 rounded-full border",
                checked ? "border-[5px] border-primary" : "border-input",
              )}
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">{accountLabel(a)}</span>
              {!usable && (
                <span className="block text-xs text-muted-foreground">
                  Can&apos;t receive money until its setup is finished in Railway
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
