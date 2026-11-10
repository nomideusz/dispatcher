package main

import (
	"path/filepath"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestHealthSeriesTakesEachDaysLastScoredReading(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "health.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TemplateSnapshot{}); err != nil {
		t.Fatal(err)
	}
	day := time.Date(2026, time.November, 1, 0, 0, 0, 0, time.UTC)
	at := func(d, h int) time.Time { return day.AddDate(0, 0, d).Add(time.Duration(h) * time.Hour) }
	rows := []TemplateSnapshot{
		{SampledAt: at(-30, 7), TemplateID: "a", Status: "PUBLISHED", Projects: 1, TemplateHealth: pointerTo(99.0)}, // before the window
		{SampledAt: at(0, 1), TemplateID: "a", Status: "PUBLISHED", Projects: 5, TemplateHealth: pointerTo(80.0), TotalDeployments: pointerTo(int64(9))},
		{SampledAt: at(0, 23), TemplateID: "a", Status: "PUBLISHED", Projects: 6}, // metrics failed late in the day
		{SampledAt: at(1, 5), TemplateID: "a", Status: "PUBLISHED", Projects: 6, TemplateHealth: pointerTo(70.0), TotalDeployments: pointerTo(int64(10))},
		{SampledAt: at(1, 6), TemplateID: "a", Status: "IMPORTED"}, // backfill zeros
		{SampledAt: at(1, 7), TemplateID: "b", Status: "PUBLISHED"},
	}
	if err := gorm.G[TemplateSnapshot](db).CreateInBatches(t.Context(), &rows, 100); err != nil {
		t.Fatal(err)
	}

	got, err := healthDayRows(t.Context(), db, at(-10, 0))
	if err != nil {
		t.Fatal(err)
	}
	s := buildHealthSeries(got)
	if len(s.Days) != 2 || s.Days[0] != "2026-11-01" || s.Days[1] != "2026-11-02" || len(s.Templates) != 2 {
		t.Fatalf("series = %+v", s)
	}
	a, b := s.Templates[0], s.Templates[1]
	if a.TemplateID != "a" || *a.Health[0] != 80 || *a.Projects[0] != 6 || *a.Deployments[0] != 9 || *a.Health[1] != 70 || *a.Deployments[1] != 10 {
		t.Fatalf("a = %+v", a)
	}
	// b has no sample on the first day and no score on the second.
	if b.TemplateID != "b" || b.Projects[0] != nil || b.Health[1] != nil || *b.Projects[1] != 0 {
		t.Fatalf("b = %+v", b)
	}
}
