export const RESEND_ON_ENTER_LS = "playpowermud-resend-on-enter";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storageRef(s?: StorageLike): StorageLike | null {
  if (s) return s;
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** Default on — empty Enter repeats the last command (original client behavior). */
export function resendOnEnterEnabled(s?: StorageLike): boolean {
  const storage = storageRef(s);
  if (!storage) return true;
  const v = storage.getItem(RESEND_ON_ENTER_LS);
  if (v === null) return true;
  const t = v.trim().toLowerCase();
  return t !== "0" && t !== "off" && t !== "false" && t !== "no";
}

export function setResendOnEnter(on: boolean, s?: StorageLike): void {
  const storage = storageRef(s);
  if (!storage) return;
  storage.setItem(RESEND_ON_ENTER_LS, on ? "1" : "0");
}