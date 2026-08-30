package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
)

func handleHealth(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sqlDB, err := db.DB()
		if err == nil {
			err = sqlDB.PingContext(r.Context())
		}
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db unreachable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func handleAuthCallback(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		stateValue := q.Get("state")
		isCLI := strings.HasPrefix(stateValue, cliOAuthStatePrefix)
		if oauthErr := q.Get("error"); oauthErr != "" && !isCLI {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error":       oauthErr,
				"description": q.Get("error_description"),
			})
			return
		}
		code := q.Get("code")
		if code == "" && q.Get("error") == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing code parameter"})
			return
		}

		creds, err := gorm.G[RailwayCredentials](db).First(r.Context())
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "no client credentials, start at /api/auth/redirect"})
			return
		}
		var cliState *cliOAuthState
		if isCLI {
			state, err := decodeCLIState(creds.ClientSecret, stateValue, time.Now())
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid or expired CLI auth state"})
				return
			}
			cliState = &state
		}
		if oauthErr := q.Get("error"); oauthErr != "" {
			message := q.Get("error_description")
			if message == "" {
				message = "Railway login was cancelled"
			}
			completeCLIAuth(*cliState, "", time.Time{}, message)
			writeCLIAuthPage(w, "CLI login failed", message)
			return
		}

		tok, err := exchangeAuthCode(r.Context(), creds, code)
		if err != nil {
			if cliState != nil {
				completeCLIAuth(*cliState, "", time.Time{}, "Railway login failed")
				writeCLIAuthPage(w, "CLI login failed", "Railway login failed. Return to the terminal and try again.")
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}

		if _, err := getAuthUser(r.Context(), tok.AccessToken); err != nil {
			if cliState != nil {
				completeCLIAuth(*cliState, "", time.Time{}, "the Railway user cannot access this workspace")
				writeCLIAuthPage(w, "CLI login failed", "This Railway user cannot access the workspace served by Dispatcher.")
				return
			}
			writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
			return
		}

		if err := saveToken(r.Context(), db, creds.ID, tok); err != nil {
			if cliState != nil {
				completeCLIAuth(*cliState, "", time.Time{}, "Dispatcher could not save the Railway session")
				writeCLIAuthPage(w, "CLI login failed", "Dispatcher could not save the Railway session.")
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if cliState != nil {
			expiresAt := time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
			if !completeCLIAuth(*cliState, tok.AccessToken, expiresAt, "") {
				writeCLIAuthPage(w, "CLI login expired", "Return to the terminal and start login again.")
				return
			}
			writeCLIAuthPage(w, "CLI login complete", "You can close this window and return to the terminal.")
			return
		}

		http.SetCookie(w, &http.Cookie{
			Name:     authCookieName,
			Value:    tok.AccessToken,
			Path:     "/",
			MaxAge:   int(tok.ExpiresIn),
			HttpOnly: true,
			Secure:   strings.HasPrefix(os.Getenv("CALLBACK_URL"), "https://"),
			SameSite: http.SameSiteLaxMode,
		})
		http.Redirect(w, r, "/", http.StatusFound)
	}
}

func handleAuthRedirect(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		creds, err := loadOrCreateRailwayCredentials(r.Context(), db)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		http.Redirect(w, r, railwayAuthorizationURL(creds, ""), http.StatusFound)
	}
}

func loadOrCreateRailwayCredentials(ctx context.Context, db *gorm.DB) (RailwayCredentials, error) {
	creds, err := gorm.G[RailwayCredentials](db).First(ctx)
	if err == nil {
		return creds, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return RailwayCredentials{}, fmt.Errorf("load Railway OAuth credentials: %w", err)
	}
	creds, err = createRailwayCredentials()
	if err != nil {
		return RailwayCredentials{}, err
	}
	if err := gorm.G[RailwayCredentials](db).Create(ctx, &creds); err != nil {
		return RailwayCredentials{}, fmt.Errorf("save Railway OAuth credentials: %w", err)
	}
	return creds, nil
}

func railwayAuthorizationURL(creds RailwayCredentials, state string) string {
	values := url.Values{
		"response_type": {"code"},
		"client_id":     {creds.ClientID},
		"redirect_uri":  {os.Getenv("CALLBACK_URL")},
		// offline_access + prompt=consent is what yields a refresh token.
		"scope":  {"openid profile email offline_access workspace:admin"},
		"prompt": {"consent"},
	}
	if state != "" {
		values.Set("state", state)
	}
	return (&url.URL{
		Scheme:   "https",
		Host:     "backboard.railway.com",
		Path:     "/oauth/auth",
		RawQuery: values.Encode(),
	}).String()
}

func handleAuthMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, authUserFrom(r))
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   strings.HasPrefix(os.Getenv("CALLBACK_URL"), "https://"),
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed out"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
