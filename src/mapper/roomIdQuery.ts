/** True when the query is a Powermud-style numeric room id (e.g. r9, r109). */
export function isNumericRoomIdQuery(query: string): boolean {
  return /^r\d+$/i.test(query.trim());
}
