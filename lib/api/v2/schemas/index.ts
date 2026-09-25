// The v2 contract, whole — B1587, phase 0. These schemas are the spec:
// validator, TypeScript type, and (later ticket) the generated
// /v2/openapi.json all come from here.
export { dayDoc, dayWrite, dayMerged, dayPatchedDraft, dayPatchedPublished, dayPatch, daySlug, daySummary, DAY_DECLINABLES, DAY_DECLINABLE_KEYS } from "./day";
export { tripCreate, tripCreateStored, tripPatch, tripPatchStored, tripDoc, TRIP_DECLINABLES, DECLINABLE_KEYS as TRIP_DECLINABLE_KEYS } from "./trip";
export { publishRequest, sendRequest } from "./publish";
export { journalDoc, journalWrite, journalPatch, JOURNAL_DECLINABLES } from "./journal";
export { mediaIntent, mediaItem, MEDIA_KINDS } from "./media";
export { dayMediaAttachRequest, dayMediaDetachRequest } from "./dayMedia";
export type { DayMediaAttachRequest, DayMediaDetachRequest } from "./dayMedia";
export { instanceStatus, journalStatus } from "./status";
export { figureDoc, journalFigures, tripFigures } from "./figures";
export type { FigureDoc } from "./figures";
export { purchaseCreate, purchaseDoc, PURCHASE_STATUSES, ledgerRow, LEDGER_REASONS } from "./money";
export type { PurchaseCreate, PurchaseDoc, LedgerRowDoc } from "./money";
export { errorEnvelope, incompleteDetails, declineReason } from "./shared";
export { geocodeRequest, geocodeResponse, geocodeCandidate } from "./geocode";
export type { GeocodeRequest } from "./geocode";
export { gpsZone, gpsZonesWrite, gpsZonesDoc } from "./gpsZones";
export type { GpsZone, GpsZonesWrite, GpsZonesDoc } from "./gpsZones";
export { journalCreate } from "./journalCreate";
export type { JournalCreate } from "./journalCreate";
export { postcardOrderWrite, postcardOrderDoc, postcardSource } from "./postcard";
export {
  PHOTOBOOK_LIMITS,
  PHOTOBOOK_OPTION_KEYS,
  PHOTOBOOK_DEFAULT_KEYS,
  photobookOptions,
  photobookDraftWrite,
  photobookDraftDoc,
} from "@paid/photobook/lib/api/v2/schemas/photobook";
export type { PhotobookDraftWrite, PhotobookDraftDoc } from "@paid/photobook/lib/api/v2/schemas/photobook";
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
export type { DayWrite, DaySummary } from "./day";
export type { TripCreate } from "./trip";
export type { PublishRequest, SendRequest } from "./publish";
export type { JournalDoc } from "./journal";
export type { MediaIntent } from "./media";
export type { InstanceStatus, JournalStatus } from "./status";
export type { ErrorEnvelope } from "./shared";
export { ownerTelDoc, ownerTelVerifyRequest, ownerTelVerifyStarted, ownerTelVerifyRedeem } from "./ownerTel";
export type { OwnerTelDoc, OwnerTelVerifyRequest, OwnerTelVerifyStarted, OwnerTelVerifyRedeem } from "./ownerTel";
export { ownerEmailPending, ownerEmailRedeem } from "./ownerEmail";
export type { OwnerEmailPending, OwnerEmailRedeem } from "./ownerEmail";
export {
  INVITE_KINDS,
  inviteWrite,
  inviteDoc,
  CONTACT_STATUSES,
  contactDoc,
  CHANNEL_NAMES,
  channelsPatch,
  channelsDoc,
} from "./social";
export type { InviteDoc, ContactDoc } from "./social";
export { dayMoveRequest, dayMoveResult, daySplitRequest, daySplitResult, dayMergeRequest, dayMergeResult } from "./reshape";
export { tripRenameRequest, tripRenameResult } from "./tripRename";
export { gpsMonthsDoc, gpsPurgeRequest } from "./gps";
export type { GpsMonthsDoc, GpsPurgeRequest } from "./gps";
