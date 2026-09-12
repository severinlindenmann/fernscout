// The v2 contract, whole — B1587, phase 0. These schemas are the spec:
// validator, TypeScript type, and (later ticket) the generated
// /v2/openapi.json all come from here.
export { dayDoc, dayWrite, dayPatch, DAY_DECLINABLES } from "./day";
export { tripCreate, tripPatch, tripDoc, TRIP_DECLINABLES } from "./trip";
export { journalDoc, journalWrite, journalPatch } from "./journal";
export { mediaIntent, mediaItem, MEDIA_KINDS } from "./media";
export { instanceStatus, journalStatus } from "./status";
export { figureDoc, journalFigures, tripFigures } from "./figures";
export type { FigureDoc } from "./figures";
export { errorEnvelope, incompleteDetails, declineReason } from "./shared";
export type { DayWrite } from "./day";
export type { TripCreate } from "./trip";
export type { JournalDoc } from "./journal";
export type { MediaIntent } from "./media";
export type { InstanceStatus, JournalStatus } from "./status";
export type { ErrorEnvelope } from "./shared";
