export function gbpToPence(input: string): number {
  const value = input.trim().replace(/^£\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("Enter a GBP amount with no more than two decimal places.");
  }
  const [pounds, fraction = ""] = value.replace(/,/g, "").split(".");
  const pence = Number(pounds) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence))
    throw new Error("That amount is too large.");
  return pence;
}

export function isCalendarDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
