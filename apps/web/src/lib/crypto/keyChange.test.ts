import { describe, expect, it } from "vitest";
import { classifyKey } from "./keyChange";

describe("key-change classification", () => {
  it("reports first contact, no change, and a changed key", () => {
    expect(classifyKey(undefined, "A")).toBe("first");
    expect(classifyKey("A", "A")).toBe("unchanged");
    expect(classifyKey("A", "B")).toBe("changed");
  });
});
