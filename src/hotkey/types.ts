/** One `/hotkey "KEY" "COMMAND"` binding (`/unhotkey NUMBER` uses list order). */
export type HotkeyRule = {
  /** Normalized key chord, e.g. `F2` or `Ctrl+Shift+KeyQ`. */
  key: string;
  command: string;
};
