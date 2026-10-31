package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestProposalURLs(t *testing.T) {
	got := proposalURLs("any of these?\nhttps://github.com/a/b\n- http://github.com/a/b/ (again)\n[c](https://github.com/c/d.git), https://example.com/x.")
	want := []string{"https://github.com/a/b", "https://github.com/c/d", "https://example.com/x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, want %q", got, want)
	}
}

// The round trip: paste, answer, paste again (the verdict stays), and new
// ones list before answered ones.
func TestProposalsRoundTrip(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "p.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Proposal{}); err != nil {
		t.Fatal(err)
	}
	call := func(h http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(method, "/api/proposals", strings.NewReader(body)))
		return rec
	}
	if rec := call(handleAddProposals(db), "POST", `{"text":"https://github.com/a/b","note":"high demand"}`); rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	if rec := call(handleAnswerProposal(db), "PUT", `{"url":"https://github.com/a/b","status":"skipped","reply":"no service"}`); rec.Code != 200 {
		t.Fatalf("answer: %d %s", rec.Code, rec.Body)
	}
	if rec := call(handleAnswerProposal(db), "PUT", `{"url":"https://github.com/a/b","status":"maybe"}`); rec.Code != 400 {
		t.Fatalf("bad status: %d", rec.Code)
	}
	call(handleAddProposals(db), "POST", `{"text":"https://github.com/a/b https://github.com/c/d"}`)

	var resp struct{ Proposals []Proposal }
	if err := json.Unmarshal(call(handleProposals(db), "GET", "").Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Proposals) != 2 || resp.Proposals[0].URL != "https://github.com/c/d" ||
		resp.Proposals[1].Status != "skipped" || resp.Proposals[1].Reply != "no service" || resp.Proposals[1].Note != "high demand" {
		t.Fatalf("got %+v", resp.Proposals)
	}
}
