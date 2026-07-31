import test from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationDestination } from "../src/services/notificationNavigation.js";

test("ticket notifications open the protected ticket details route", () => {
  assert.deepEqual(
    resolveNotificationDestination({ related_ticket_id: 46 }, "Technician"),
    { path: "/ticket/46", label: "View ticket" }
  );
});

test("software license reminders open license management for authorized managers", () => {
  assert.deepEqual(
    resolveNotificationDestination({ related_entity_type: "software_license", related_entity_id: 7 }, "Admin"),
    { path: "/software-licenses", label: "View licenses" }
  );
});

test("endpoint policy notifications retain the device context", () => {
  assert.deepEqual(
    resolveNotificationDestination({
      related_entity_type: "endpoint_policy",
      related_entity_id: "device-uuid",
    }, "SuperAdmin"),
    { path: "/endpoint-management?tab=devices&deviceId=device-uuid", label: "View endpoint" }
  );
});

test("consent and lifecycle destinations respect the current role", () => {
  assert.deepEqual(
    resolveNotificationDestination({ related_entity_type: "consent" }, "Employee"),
    { path: "/employee/consent", label: "View consent" }
  );
  assert.deepEqual(
    resolveNotificationDestination({ related_entity_type: "consent" }, "HR"),
    { path: "/hr/lifecycle", label: "View consent" }
  );
  assert.deepEqual(
    resolveNotificationDestination({ related_entity_type: "employee_lifecycle_case" }, "HR"),
    { path: "/hr/lifecycle", label: "View lifecycle" }
  );
});

test("legacy titles are recognized and unsafe explicit paths are ignored", () => {
  assert.deepEqual(
    resolveNotificationDestination({ title: "Software License Renewal Reminder" }, "SuperAdmin"),
    { path: "/software-licenses", label: "View licenses" }
  );
  assert.deepEqual(
    resolveNotificationDestination({ metadata: { path: "https://malicious.example" } }, "Admin"),
    { path: "/admin/dashboard", label: "View workspace" }
  );
});
