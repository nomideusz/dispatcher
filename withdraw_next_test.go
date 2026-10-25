package main

import (
	"testing"
	"time"
)

func TestNextRuns(t *testing.T) {
	from := time.Date(2026, 10, 25, 17, 0, 0, 0, time.UTC) // a Sunday
	runs, err := nextRuns("0 8 * * 1", from, 2)
	if err != nil {
		t.Fatal(err)
	}
	want := []time.Time{
		time.Date(2026, 10, 26, 8, 0, 0, 0, time.UTC),
		time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC),
	}
	if len(runs) != 2 || !runs[0].Equal(want[0]) || !runs[1].Equal(want[1]) {
		t.Fatalf("got %v, want %v", runs, want)
	}
	if _, err := nextRuns("0 8 * *", from, 1); err == nil {
		t.Fatal("a four-field spec should be rejected")
	}
	// Feb 30 never comes: Next gives up and returns zero.
	if runs, err := nextRuns("0 8 30 2 *", from, 3); err != nil || len(runs) != 0 {
		t.Fatalf("got %v, %v", runs, err)
	}
}
