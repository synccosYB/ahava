export interface EmployeeName {
  firstName: string;
  lastName: string;
}

/** Clock exports use "Last First [Middle]" or "Last, First [Middle]".
 * Separate name columns avoid guessing where a compound surname ends.
 */
export function parseEmployeeName(raw: string): EmployeeName {
  const name = raw.trim().replace(/\s+/g, " ");
  const comma = name.indexOf(",");
  if (comma >= 0) {
    return {
      firstName: name.slice(comma + 1).trim(),
      lastName: name.slice(0, comma).trim(),
    };
  }
  const [lastName = "", ...givenNames] = name.split(" ");
  return givenNames.length
    ? { firstName: givenNames.join(" "), lastName }
    : { firstName: lastName, lastName: "" };
}
