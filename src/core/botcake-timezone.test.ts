import { describe, expect, it } from "vitest";
import { isSameBotcakeTimezone, toBotcakeTimezoneValue } from "./botcake-timezone";

describe("Botcake timezone values", () => {
  it("keeps Botcake's decimal suffix for integer offsets", () => {
    expect(toBotcakeTimezoneValue(8)).toBe("8.0");
    expect(toBotcakeTimezoneValue(-12)).toBe("-12.0");
  });

  it("preserves fractional offsets", () => {
    expect(toBotcakeTimezoneValue(5.5)).toBe("5.5");
    expect(toBotcakeTimezoneValue(5.75)).toBe("5.75");
  });

  it("does not treat the malformed integer string as an existing Botcake option", () => {
    expect(isSameBotcakeTimezone("8.0", 8)).toBe(true);
    expect(isSameBotcakeTimezone("8", 8)).toBe(false);
  });
});
