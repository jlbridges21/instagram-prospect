export function isMissingRelation(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /does not exist/i.test(error.message ?? "") ||
    /schema cache/i.test(error.message ?? "")
  );
}

export function databaseErrorMessage(error: { message?: string } | null) {
  return error?.message || "The database request failed.";
}
