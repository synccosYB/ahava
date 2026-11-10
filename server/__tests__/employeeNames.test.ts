import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEmployeeName } from "../services/employeeNames";

test("clock names store given names first and family names second", () => {
  assert.deepEqual(parseEmployeeName("ABADI Miriam"), { firstName: "Miriam", lastName: "ABADI" });
  assert.deepEqual(parseEmployeeName("ABDOU Nourhan Ussma"), { firstName: "Nourhan Ussma", lastName: "ABDOU" });
  assert.deepEqual(parseEmployeeName("  Aharoni   Daniel zev  "), { firstName: "Daniel zev", lastName: "Aharoni" });
});

test("comma separates a compound surname from all given names", () => {
  assert.deepEqual(parseEmployeeName("Baksh Ovalle, Fazeila"), { firstName: "Fazeila", lastName: "Baksh Ovalle" });
  assert.deepEqual(parseEmployeeName("Aricapa, Jorge"), { firstName: "Jorge", lastName: "Aricapa" });
});

test("single names and blanks do not invent a surname", () => {
  assert.deepEqual(parseEmployeeName("Miriam"), { firstName: "Miriam", lastName: "" });
  assert.deepEqual(parseEmployeeName(""), { firstName: "", lastName: "" });
});
