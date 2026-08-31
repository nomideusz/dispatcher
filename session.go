package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

// refreshGroup collapses the burst of refreshes that happens when a client
// comes back after its access token expired and fires several API calls at
// once. One refresh serves them all, which keeps a single valid grant even if
// Railway rotates the refresh token.
var refreshGroup singleflight.Group

const (
	// sessionCookieMaxAge is how long a client keeps the session cookie. The
	// Railway tokens inside it are refreshed transparently, so the login ends
	// only when Railway stops honouring the refresh token. 400 days is the
	// ceiling browsers accept for a cookie.
	sessionCookieMaxAge = 400 * 24 * time.Hour
	// refreshLeeway renews the access token slightly early so a request never
	// races the expiry of the token it is about to use.
	refreshLeeway = time.Minute
)

// session is the Railway login carried by the auth cookie. It holds the whole
// OAuth grant, not just the access token, so an expired access token is a
// refresh rather than a new login. Field names are short because the encrypted
// form has to fit in a cookie.
type session struct {
	AccessToken  string    `json:"a"`
	RefreshToken string    `json:"r"`
	ExpiresAt    time.Time `json:"e"`
}

func newSession(tok tokenResponse, now time.Time) session {
	return session{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		ExpiresAt:    now.Add(time.Duration(tok.ExpiresIn) * time.Second),
	}
}

func (s session) needsRefresh(now time.Time) bool {
	return !now.Add(refreshLeeway).Before(s.ExpiresAt)
}

// resolveSession returns a session with a usable access token, refreshing the
// Railway grant when the current token is spent. The bool reports whether the
// caller has to hand the client the re-encoded session.
func resolveSession(ctx context.Context, db *gorm.DB, creds RailwayCredentials, current session, now time.Time) (session, bool, error) {
	if !current.needsRefresh(now) {
		return current, false, nil
	}
	if current.RefreshToken == "" {
		return session{}, false, errors.New("session has no refresh token")
	}
	renewed, err, _ := refreshGroup.Do(current.RefreshToken, func() (any, error) {
		creds.RefreshToken = current.RefreshToken
		tok, err := refreshAccessToken(ctx, creds)
		if err != nil {
			return nil, err
		}
		refreshed := newSession(tok, now)
		// Railway may answer without rotating the refresh token; keep the one
		// we already have so the next refresh still works.
		if refreshed.RefreshToken == "" {
			refreshed.RefreshToken = current.RefreshToken
		}
		// Background jobs share the workspace grant, so hand them the token
		// this refresh just produced instead of leaving them on a stale one.
		if err := saveToken(ctx, db, creds.ID, tok); err != nil {
			log.Printf("save refreshed workspace token: %v", err)
		}
		return refreshed, nil
	})
	if err != nil {
		return session{}, false, fmt.Errorf("refresh session: %w", err)
	}
	return renewed.(session), true, nil
}

// encodeSession seals a session with the OAuth client secret. The cookie is
// encrypted rather than merely signed so that a leaked cookie cannot be
// replayed against Railway's API directly, and authenticated so a client
// cannot edit the grant it was handed.
func encodeSession(secret string, s session) (string, error) {
	plaintext, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	aead, err := sessionCipher(secret)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate session nonce: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(aead.Seal(nonce, nonce, plaintext, nil)), nil
}

func decodeSession(secret, value string) (session, error) {
	sealed, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return session{}, errors.New("malformed session")
	}
	aead, err := sessionCipher(secret)
	if err != nil {
		return session{}, err
	}
	if len(sealed) < aead.NonceSize() {
		return session{}, errors.New("malformed session")
	}
	plaintext, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], nil)
	if err != nil {
		return session{}, errors.New("session could not be decrypted")
	}
	var s session
	if err := json.Unmarshal(plaintext, &s); err != nil {
		return session{}, errors.New("malformed session")
	}
	if s.AccessToken == "" {
		return session{}, errors.New("session has no access token")
	}
	return s, nil
}

func sessionCipher(secret string) (cipher.AEAD, error) {
	if secret == "" {
		return nil, errors.New("no OAuth client secret to protect sessions with")
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func setSessionCookie(w http.ResponseWriter, value string, now time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(sessionCookieMaxAge / time.Second),
		Expires:  now.Add(sessionCookieMaxAge),
		HttpOnly: true,
		Secure:   secureAuthCookies(),
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   secureAuthCookies(),
		SameSite: http.SameSiteLaxMode,
	})
}
