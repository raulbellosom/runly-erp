import { test } from "node:test";
import assert from "node:assert/strict";
import * as Lucide from "lucide-react";
import { resolveFieldIcon } from "../field-icons.js";
import { autoFieldIcon } from "../../lib/field-icon-inference.js";

test("infers icons from field name before label", () => {
  assert.equal(resolveFieldIcon({ name: "workEmail", label: "Correo laboral", type: "text" }), Lucide.Mail);
  assert.equal(resolveFieldIcon({ name: "emergencyContactPhone", label: "Teléfono de emergencia", type: "text" }), Lucide.Phone);
  assert.equal(resolveFieldIcon({ name: "jobTitleId", label: "Puesto", type: "relation" }), Lucide.BriefcaseBusiness);
  assert.equal(resolveFieldIcon({ name: "employeeCode", label: "Código", type: "text" }), Lucide.Hash);
  assert.equal(resolveFieldIcon({ name: "status", label: "Estado", type: "select" }), Lucide.CircleDot);
  assert.equal(resolveFieldIcon({ name: "state", label: "Estado", type: "text" }), Lucide.MapPinned);
});

test("falls back to the Spanish label, then the type", () => {
  assert.equal(resolveFieldIcon({ name: "f1", label: "Ubicación de trabajo", type: "text" }), Lucide.MapPin);
  assert.equal(resolveFieldIcon({ name: "f2", label: "Zzz", type: "select" }), Lucide.List);
  assert.equal(resolveFieldIcon({ name: "x", icon: "Car", type: "text" }), Lucide.Car);
  assert.equal(resolveFieldIcon({ name: "paymentDate", type: "date" }), Lucide.CalendarDays);
});

test("autoFieldIcon respects explicit icons, null opt-out and unlabeled inputs", () => {
  assert.equal(autoFieldIcon(Lucide.Star, { label: "Correo" }), Lucide.Star);
  assert.equal(autoFieldIcon(null, { label: "Correo" }), null);
  assert.equal(autoFieldIcon(undefined, { name: "email" }), null);
  assert.equal(autoFieldIcon(undefined, { label: "Correo" }), Lucide.Mail);
  assert.equal(autoFieldIcon(undefined, { label: "Zzz" }, Lucide.Type), Lucide.Type);
});
