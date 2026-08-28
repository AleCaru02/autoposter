import assert from "node:assert/strict";
import { metricsCapability, normalizeFacebookPostMetrics, normalizeGoogleBusinessMetrics, normalizeInstagramMediaMetrics, normalizeLinkedInMetrics } from "../api/_lib/social-metrics.js";

assert.equal(metricsCapability({ provider: "INSTAGRAM", connectionStatus: "ACTIVE", providerAccountId: "ig-1", permissions: ["instagram_basic", "pages_read_engagement"] }).available, false, "Instagram analytics must fail closed without instagram_manage_insights");
assert.equal(metricsCapability({ provider: "INSTAGRAM", connectionStatus: "ACTIVE", providerAccountId: "ig-1", permissions: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"] }).available, true);
assert.equal(metricsCapability({ provider: "FACEBOOK", connectionStatus: "ACTIVE", providerAccountId: "page-1", permissions: ["pages_read_engagement"] }).available, true);
assert.equal(metricsCapability({ provider: "LINKEDIN", connectionStatus: "ACTIVE", providerAccountId: "member-1", permissions: ["w_member_social"] }).available, false, "publishing permission alone must not imply analytics access");
assert.equal(metricsCapability({ provider: "LINKEDIN", connectionStatus: "ACTIVE", providerAccountId: "member-1", permissions: ["r_member_postAnalytics"] }).available, true);
assert.equal(metricsCapability({ provider: "LINKEDIN", connectionStatus: "ACTIVE", providerAccountId: "org-1", permissions: ["rw_organization_admin"], linkedinOrganizationMode: true }).available, true);
assert.equal(metricsCapability({ provider: "GBP", connectionStatus: "ACTIVE", providerAccountId: "locations/1", permissions: ["https://www.googleapis.com/auth/business.manage"], googlePerformanceApiEnabled: false }).reason, "GBP_PERFORMANCE_API_NOT_ENABLED");
assert.equal(metricsCapability({ provider: "GBP", connectionStatus: "ACTIVE", providerAccountId: "locations/1", permissions: ["https://www.googleapis.com/auth/business.manage"], googlePerformanceApiEnabled: true }).available, true);

const capturedAt = "2026-08-29T00:00:00.000Z";
const instagram = normalizeInstagramMediaMetrics({ externalPostId: "ig-post", capturedAt, basic: { like_count: 12, comments_count: "3" }, insights: [{ name: "reach", values: [{ value: 120 }] }, { name: "saved", values: [{ value: 4 }] }] });
assert.deepEqual(instagram.map((item) => [item.metric, item.value]), [["likes", 12], ["comments", 3], ["reach", 120], ["saved", 4]]);
assert.ok(instagram.every((item) => item.externalPostId === "ig-post"));

const facebook = normalizeFacebookPostMetrics({ externalPostId: "fb-post", capturedAt, counters: { reactions: 8, comments: 2, shares: 1 }, insights: [{ name: "post_impressions_unique", values: [{ value: 90 }] }] });
assert.deepEqual(facebook.map((item) => [item.metric, item.value]), [["reactions", 8], ["comments", 2], ["shares", 1], ["post_impressions_unique", 90]]);

const linkedin = normalizeLinkedInMetrics({ externalPostId: "urn:li:share:1", capturedAt, statistics: { impressionCount: 1000, uniqueImpressionsCount: 700, clickCount: 25, engagement: 0.034, POST_SAVE: 9 } });
assert.deepEqual(linkedin.map((item) => item.metric), ["impressions", "reach", "clicks", "engagement_rate", "saves"]);

const google = normalizeGoogleBusinessMetrics({ capturedAt, dailyMetrics: [{ dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", timeSeries: { datedValues: [{ date: { year: 2026, month: 8, day: 28 }, value: "44" }] } }] });
assert.equal(google.length, 1);
assert.equal(google[0].value, 44);
assert.equal(google[0].capturedAt, "2026-08-28T00:00:00.000Z");
assert.equal(google[0].metadata?.source, "business_profile_performance_v1");

assert.deepEqual(normalizeInstagramMediaMetrics({ externalPostId: "none", capturedAt, basic: { like_count: "not-a-number" }, insights: [] }), [], "invalid payload values must never become demo metrics");

console.log("PASS social metrics: capabilities fail closed and only real numeric provider payloads are normalized.");