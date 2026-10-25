package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"time"

	"github.com/robfig/cron/v3"
	"gorm.io/gorm"
)

func handleWithdrawSettings(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s, err := loadAutoWithdrawSettings(r.Context(), db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, s)
	}
}

// handleWithdrawNext previews a cron spec with the parser the job runs on:
// the next three runs in UTC, or why the spec is rejected. The setup dialog
// shows it before anything is saved.
func handleWithdrawNext() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runs, err := nextRuns(r.URL.Query().Get("schedule"), time.Now(), 3)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid schedule: " + err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string][]time.Time{"next": runs})
	}
}

func nextRuns(spec string, from time.Time, n int) ([]time.Time, error) {
	schedule, err := cron.ParseStandard(spec)
	if err != nil {
		return nil, err
	}
	runs := make([]time.Time, 0, n)
	for t := from.UTC(); len(runs) < n; {
		t = schedule.Next(t)
		if t.IsZero() {
			break
		}
		runs = append(runs, t)
	}
	return runs, nil
}

type withdrawAccountsResponse struct {
	AvailableBalance int64               `json:"availableBalance"` // cents
	MinimumBalance   int64               `json:"minimumBalance"`   // cents
	Accounts         []withdrawalAccount `json:"accounts"`
}

// handleWithdrawAccounts lists the payout destinations and current balance for
// the workspace this app serves, so the setup modal can offer a choice.
func handleWithdrawAccounts(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		token, customerID, err := workspaceCustomer(ctx, db)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		balance, err := getAvailableBalance(ctx, token, customerID)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		accounts, err := getWithdrawalAccounts(ctx, token, customerID)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, withdrawAccountsResponse{
			AvailableBalance: balance,
			MinimumBalance:   withdrawMinimumCents,
			Accounts:         accounts,
		})
	}
}

type withdrawSettingsRequest struct {
	Enabled             bool   `json:"enabled"`
	WithdrawalAccountID string `json:"withdrawalAccountId"`
	Schedule            string `json:"schedule"`
}

// handleUpdateWithdrawSettings turns auto-withdraw on or off. When enabling,
// it verifies the chosen account really belongs to this workspace's customer
// before storing it for the cron.
func handleUpdateWithdrawSettings(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req withdrawSettingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		ctx := r.Context()
		s, err := loadAutoWithdrawSettings(ctx, db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.Enabled = req.Enabled

		// An omitted schedule keeps the current one, so turning the job off
		// doesn't reset a custom cadence.
		if req.Schedule != "" {
			if _, err := cron.ParseStandard(req.Schedule); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid schedule: " + err.Error()})
				return
			}
			s.Schedule = req.Schedule
		}

		if req.Enabled {
			if req.WithdrawalAccountID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "withdrawalAccountId is required to enable auto-withdraw"})
				return
			}
			token, customerID, err := workspaceCustomer(ctx, db)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			accounts, err := getWithdrawalAccounts(ctx, token, customerID)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
				return
			}
			if !slices.ContainsFunc(accounts, func(a withdrawalAccount) bool { return a.ID == req.WithdrawalAccountID }) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown withdrawal account"})
				return
			}
			s.WithdrawalAccountID = req.WithdrawalAccountID
		}

		if err := saveAutoWithdrawSettings(ctx, db, s); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		// Swap the live cron entry so the new cadence applies without a
		// restart. The spec was validated above, so this cannot fail.
		if err := scheduleAutoWithdraw(db, s.Schedule); err != nil {
			log.Printf("auto-withdraw: reschedule: %v", err)
		}
		// Attempt a withdrawal right away instead of waiting for the next
		// tick, and say what happened; runAutoWithdraw re-checks all
		// guardrails so this is safe even when the balance is below the
		// minimum or one is already pending.
		resp := struct {
			AutoWithdrawSettings
			Attempt *withdrawAttempt `json:"attempt,omitempty"`
		}{AutoWithdrawSettings: s}
		if req.Enabled {
			a := runAutoWithdraw(db)
			resp.Attempt = &a
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// workspaceCustomer returns a valid access token and the billing customer id
// for the workspace this app is deployed in.
func workspaceCustomer(ctx context.Context, db *gorm.DB) (token, customerID string, err error) {
	token, err = workspaceToken(ctx, db)
	if err != nil {
		return "", "", err
	}
	workspaceID, err := getWorkspaceID(ctx, token)
	if err != nil {
		return "", "", err
	}
	customerID, err = getWorkspaceCustomerID(ctx, token, workspaceID)
	if err != nil {
		return "", "", err
	}
	return token, customerID, nil
}
