package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestTemplateSnapshotPersistsCompleteMetrics(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "snapshots.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TemplateSnapshot{}); err != nil {
		t.Fatal(err)
	}

	metrics := templateMetrics{
		TotalDeployments:        242,
		ActiveDeployments:       46,
		DeploymentsLast90Days:   11,
		TotalEarnings:           2411.65,
		EarningsLast90Days:      479.96,
		EarningsLast30Days:      172.78,
		TemplateHealth:          96,
		SupportHealth:           100,
		EligibleForSupportBonus: true,
	}
	snapshot := templateSnapshotAt(
		time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC),
		func() workspaceTemplate {
			w := workspaceTemplate{ID: "template-1", Name: "Template", Code: "template", Status: "PUBLISHED", CreatedAt: time.Date(2025, time.March, 4, 10, 0, 0, 0, time.UTC), TotalPayout: 2411.65, Projects: 120, RecentProjects: 7, ActiveProjects: 30}
			w.SerializedConfig.Services = map[string]json.RawMessage{"a": nil, "b": nil, "c": nil}
			return w
		}(),
		&metrics,
	)
	if err := gorm.G[TemplateSnapshot](db).Create(t.Context(), &snapshot); err != nil {
		t.Fatal(err)
	}
	got, err := gorm.G[TemplateSnapshot](db).Where("template_id = ?", "template-1").First(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	if got.TotalDeployments == nil || *got.TotalDeployments != metrics.TotalDeployments ||
		got.ActiveDeployments == nil || *got.ActiveDeployments != metrics.ActiveDeployments ||
		got.DeploymentsLast90Days == nil || *got.DeploymentsLast90Days != metrics.DeploymentsLast90Days {
		t.Errorf("deployment metrics were not persisted: %+v", got)
	}
	if got.TotalEarnings == nil || *got.TotalEarnings != metrics.TotalEarnings ||
		got.EarningsLast90Days == nil || *got.EarningsLast90Days != metrics.EarningsLast90Days ||
		got.EarningsLast30Days == nil || *got.EarningsLast30Days != metrics.EarningsLast30Days {
		t.Errorf("earnings metrics were not persisted: %+v", got)
	}
	if got.TemplateHealth == nil || *got.TemplateHealth != metrics.TemplateHealth ||
		got.SupportHealth == nil || *got.SupportHealth != metrics.SupportHealth ||
		got.EligibleForSupportBonus == nil || *got.EligibleForSupportBonus != metrics.EligibleForSupportBonus {
		t.Errorf("health metrics were not persisted: %+v", got)
	}
	// Project counts and payout come from the template list, not the metrics
	// (whose deployment counts are a different, larger measure).
	if got.Projects != 120 || got.ActiveProjects != 30 || got.RecentProjects != 7 || got.TotalPayout != 2411.65 || got.Services != 3 {
		t.Errorf("template-list fields were not persisted: %+v", got)
	}
	if got.PublishedAt == nil || !got.PublishedAt.Equal(time.Date(2025, time.March, 4, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("publishedAt = %v, want Railway createdAt", got.PublishedAt)
	}
}

func TestLoadTemplatePublishesPrefersCreatedAtOverFirstSeen(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "publishes.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TemplateSnapshot{}); err != nil {
		t.Fatal(err)
	}
	created := time.Date(2025, time.January, 15, 0, 0, 0, 0, time.UTC)
	seen := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	if err := gorm.G[TemplateSnapshot](db).Create(t.Context(), &TemplateSnapshot{
		SampledAt: seen, TemplateID: "with-date", Status: "PUBLISHED", PublishedAt: &created,
	}); err != nil {
		t.Fatal(err)
	}
	if err := gorm.G[TemplateSnapshot](db).Create(t.Context(), &TemplateSnapshot{
		SampledAt: seen, TemplateID: "legacy", Status: "PUBLISHED",
	}); err != nil {
		t.Fatal(err)
	}
	if err := gorm.G[TemplateSnapshot](db).Create(t.Context(), &TemplateSnapshot{
		SampledAt: seen, TemplateID: "draft", Status: "UNPUBLISHED", PublishedAt: &created,
	}); err != nil {
		t.Fatal(err)
	}

	got, err := loadTemplatePublishes(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]time.Time{}
	for _, p := range got {
		byID[p.TemplateID] = p.PublishedAt
	}
	if !byID["with-date"].Equal(created) {
		t.Errorf("with-date = %v, want Railway createdAt", byID["with-date"])
	}
	if !byID["legacy"].Equal(seen) {
		t.Errorf("legacy = %v, want first published sample", byID["legacy"])
	}
	if _, ok := byID["draft"]; ok {
		t.Errorf("unpublished draft was counted")
	}
}

func TestTemplateSnapshotLeavesUnpublishedMetricsUnknown(t *testing.T) {
	got := templateSnapshotAt(time.Now(), workspaceTemplate{ID: "draft", Status: "UNPUBLISHED"}, nil)
	if got.TotalDeployments != nil || got.TotalEarnings != nil || got.TemplateHealth != nil || got.EligibleForSupportBonus != nil {
		t.Fatalf("unpublished template received metrics: %+v", got)
	}
}
