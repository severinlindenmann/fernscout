// The v2 contract, whole — B1587, phase 0. These schemas are the spec:
// validator, TypeScript type, and (later ticket) the generated
// /v2/openapi.json all come from here.
export { dayDoc, dayWrite, dayPatch, DAY_DECLINABLES } from "./day";
export { tripCreate, tripPatch, tripDoc, TRIP_DECLINABLES } from "./trip";
export { journalDoc, journalWrite, journalPatch, JOURNAL_DECLINABLES } from "./journal";
export { mediaIntent, mediaItem, MEDIA_KINDS } from "./media";
export { instanceStatus, journalStatus } from "./status";
export { figureDoc, journalFigures, tripFigures } from "./figures";
export type { FigureDoc } from "./figures";
export { errorEnvelope, incompleteDetails, declineReason } from "./shared";
export { geocodeRequest, geocodeResponse, geocodeCandidate } from "./geocode";
export type { GeocodeRequest } from "./geocode";
export { journalCreate } from "./journalCreate";
export type { JournalCreate } from "./journalCreate";
export { postcardOrderWrite, postcardOrderDoc, postcardSource } from "./postcard";
export type { PostcardOrderWrite, PostcardOrderDoc } from "./postcard";
export { statementRead, costsApplyRequest } from "./statement";
export type { StatementRead, CostsApplyRequest } from "./statement";
export { inboxList } from "./inbox";
export type { InboxList } from "./inbox";
export {
  CREDENTIAL_FOR,
  CREDENTIAL_TO_SESSION_KIND,
  codesRequest,
  codesRequestResponse,
  codesRedeemRequest,
  codesRedeemCookieResponse,
  codesRedeemTokenResponse,
  linksRedeemRequest,
  linksRedeemResponse,
} from "./auth";
export type { CredentialFor, CodesRequest, CodesRedeemRequest, LinksRedeemRequest } from "./auth";
export type { DayWrite } from "./day";
export type { TripCreate } from "./trip";
export type { JournalDoc } from "./journal";
export type { MediaIntent } from "./media";
export type { InstanceStatus, JournalStatus } from "./status";
export type { ErrorEnvelope } from "./shared";
