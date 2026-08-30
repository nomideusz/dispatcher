package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestTemplateMetricsDecodesCompleteResponse(t *testing.T) {
	payload := `{
		"totalDeployments":242,
		"activeDeployments":46,
		"deploymentsLast90Days":11,
		"totalEarnings":2411.65,
		"earningsLast90Days":479.96,
		"earningsLast30Days":172.78,
		"templateHealth":96,
		"supportHealth":100,
		"eligibleForSupportBonus":true
	}`
	var got templateMetrics
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatal(err)
	}
	if got.TotalDeployments != 242 || got.ActiveDeployments != 46 || got.DeploymentsLast90Days != 11 {
		t.Errorf("deployment metrics = %+v", got)
	}
	if got.TotalEarnings != 2411.65 || got.EarningsLast90Days != 479.96 || got.EarningsLast30Days != 172.78 {
		t.Errorf("earnings metrics = %+v", got)
	}
	if got.TemplateHealth != 96 || got.SupportHealth != 100 || !got.EligibleForSupportBonus {
		t.Errorf("health metrics = %+v", got)
	}
}

func TestTemplateMetricsQuerySelectsEveryField(t *testing.T) {
	if strings.Count(templateMetricsQuery, "templateMetrics(id:") != 1 {
		t.Fatalf("query does not contain the singular metrics call:\n%s", templateMetricsQuery)
	}
	for _, field := range []string{
		"totalDeployments", "activeDeployments", "deploymentsLast90Days",
		"totalEarnings", "earningsLast90Days", "earningsLast30Days",
		"templateHealth", "supportHealth", "eligibleForSupportBonus",
	} {
		if strings.Count(templateMetricsQuery, field) != 1 {
			t.Errorf("field %q occurs %d times, want 1", field, strings.Count(templateMetricsQuery, field))
		}
	}
}
