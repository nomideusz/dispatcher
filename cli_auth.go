package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

const (
	cliOAuthStatePrefix = "cli."
	cliOAuthStateTTL    = 10 * time.Minute
	maxPendingCLILogins = 128
)

// cliOAuthState survives the round trip through Railway. It identifies the
// pending CLI login and carries the verifier challenge. The signature prevents
// either value from being changed in the browser.
type cliOAuthState struct {
	LoginCode string `json:"loginCode"`
	Challenge string `json:"challenge"`
	ExpiresAt int64  `json:"expiresAt"`
}

func handleCLIAuthStart(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		var request struct {
			Challenge string `json:"challenge"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil || !validCLISecret(request.Challenge) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		creds, err := loadOrCreateRailwayCredentials(r.Context(), db)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		now := time.Now()
		loginCode, expiresAt, err := cliAuthHandoffs.start(request.Challenge, now)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		state, err := encodeCLIState(creds.ClientSecret, cliOAuthState{
			LoginCode: loginCode,
			Challenge: request.Challenge,
			ExpiresAt: expiresAt.Unix(),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]any{
			"authorizationUrl": railwayAuthorizationURL(creds, state),
			"code":             loginCode,
			"expiresAt":        expiresAt,
		})
	}
}

func handleCLIAuthExchange(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var request struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || !validCLISecret(request.Code) || !validCLISecret(request.Verifier) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	handoff, status := cliAuthHandoffs.exchange(request.Code, request.Verifier, time.Now())
	w.Header().Set("Cache-Control", "no-store")
	switch status {
	case cliHandoffPending:
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
	case cliHandoffReady:
		writeJSON(w, http.StatusOK, map[string]any{
			"session":   handoff.Session,
			"expiresAt": handoff.SessionExpiresAt,
		})
	case cliHandoffFailed:
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": handoff.Error})
	default:
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired CLI login"})
	}
}

func validCLISecret(value string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32
}

func encodeCLIState(secret string, state cliOAuthState) (string, error) {
	payload, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	signature := signCLIState(secret, encodedPayload)
	return cliOAuthStatePrefix + encodedPayload + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func decodeCLIState(secret, encoded string, now time.Time) (cliOAuthState, error) {
	parts := strings.Split(encoded, ".")
	if len(parts) != 3 || parts[0] != strings.TrimSuffix(cliOAuthStatePrefix, ".") {
		return cliOAuthState{}, errors.New("invalid CLI auth state")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, signCLIState(secret, parts[1])) {
		return cliOAuthState{}, errors.New("invalid CLI auth state signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return cliOAuthState{}, errors.New("invalid CLI auth state payload")
	}
	var state cliOAuthState
	if err := json.Unmarshal(payload, &state); err != nil {
		return cliOAuthState{}, errors.New("invalid CLI auth state payload")
	}
	if state.ExpiresAt <= now.Unix() {
		return cliOAuthState{}, errors.New("expired CLI auth state")
	}
	if !validCLISecret(state.LoginCode) || !validCLISecret(state.Challenge) {
		return cliOAuthState{}, errors.New("invalid CLI auth state payload")
	}
	return state, nil
}

func signCLIState(secret, payload string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func completeCLIAuth(state cliOAuthState, session string, sessionExpiresAt time.Time, message string) bool {
	return cliAuthHandoffs.complete(state.LoginCode, session, sessionExpiresAt, message, time.Now())
}

func writeCLIAuthPage(w http.ResponseWriter, title, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = fmt.Fprintf(w, "<!doctype html><title>%s</title><h1>%s</h1><p>%s</p>",
		html.EscapeString(title), html.EscapeString(title), html.EscapeString(message))
}

type cliHandoffStatus uint8

const (
	cliHandoffInvalid cliHandoffStatus = iota
	cliHandoffPending
	cliHandoffReady
	cliHandoffFailed
)

type cliAuthHandoff struct {
	Challenge        string
	ConsumeBefore    time.Time
	Complete         bool
	Session          string
	SessionExpiresAt time.Time
	Error            string
}

type cliAuthHandoffStore struct {
	mu      sync.Mutex
	entries map[string]cliAuthHandoff
}

var cliAuthHandoffs = cliAuthHandoffStore{entries: make(map[string]cliAuthHandoff)}

func (s *cliAuthHandoffStore) start(challenge string, now time.Time) (string, time.Time, error) {
	if !validCLISecret(challenge) {
		return "", time.Time{}, errors.New("invalid CLI login challenge")
	}
	code, err := randomURLToken(32)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("generate CLI login code: %w", err)
	}
	expiresAt := now.Add(cliOAuthStateTTL)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(now)
	if len(s.entries) >= maxPendingCLILogins {
		return "", time.Time{}, errors.New("too many pending CLI logins")
	}
	s.entries[code] = cliAuthHandoff{Challenge: challenge, ConsumeBefore: expiresAt}
	return code, expiresAt, nil
}

func (s *cliAuthHandoffStore) complete(code, session string, sessionExpiresAt time.Time, message string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(now)
	handoff, ok := s.entries[code]
	if !ok || handoff.Complete {
		return false
	}
	handoff.Complete = true
	if message != "" {
		handoff.Error = message
	} else if session == "" || !sessionExpiresAt.After(now) {
		handoff.Error = "Dispatcher returned an invalid Railway session"
	} else {
		handoff.Session = session
		handoff.SessionExpiresAt = sessionExpiresAt
	}
	s.entries[code] = handoff
	return true
}

func (s *cliAuthHandoffStore) exchange(code, verifier string, now time.Time) (cliAuthHandoff, cliHandoffStatus) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(now)
	handoff, ok := s.entries[code]
	if !ok {
		return cliAuthHandoff{}, cliHandoffInvalid
	}
	if !hmac.Equal([]byte(handoff.Challenge), []byte(cliLoginChallenge(verifier))) {
		return cliAuthHandoff{}, cliHandoffInvalid
	}
	if !handoff.Complete {
		return cliAuthHandoff{}, cliHandoffPending
	}
	delete(s.entries, code)
	if handoff.Error != "" {
		return handoff, cliHandoffFailed
	}
	return handoff, cliHandoffReady
}

func (s *cliAuthHandoffStore) prune(now time.Time) {
	for code, handoff := range s.entries {
		if !handoff.ConsumeBefore.After(now) {
			delete(s.entries, code)
		}
	}
}

func cliLoginChallenge(verifier string) string {
	digest := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func randomURLToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
