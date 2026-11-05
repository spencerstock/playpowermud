/** One `/when "TRIGGER" "COMMAND"` rule (order in the list is the `/unwhen NUMBER`). */
export type WhenRule = {
  match: string;
  command: string;
};
