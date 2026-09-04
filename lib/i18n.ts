import type { Locale } from "./types";

/** The locales we maintain chrome translations for. A journal may offer
 * others; their chrome falls back to English (ROADMAP §1.2). */
export const MAINTAINED_LOCALES = ["en", "de", "hu"] as const;

export const LOCALE_LABEL: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  hu: "Magyar",
};

/** Short label for the switcher chip. */
export const LOCALE_SHORT: Record<string, string> = {
  en: "EN",
  de: "DE",
  hu: "HU",
};

/**
 * UI strings.
 *
 * The dictionaries live in `content/locales/<code>.json` and are read on the
 * server by `lib/locales.ts`, then handed to `LocaleProvider` as props. They
 * are not imported here: a static import would ship every language to every
 * reader, and would mean adding a language required a code change.
 *
 * `TranslationKey` is generated from the shipped English file, so every
 * `t("…")` call site is still checked at compile time. Regenerate it with
 * `npm run i18n:keys` after adding a key.
 */
export type TranslationKey =
  | "a11y.closePhoto"
  | "a11y.nextPhoto"
  | "a11y.openPhoto"
  | "a11y.photoPosition"
  | "a11y.photoViewer"
  | "a11y.prevPhoto"
  | "a11y.skipToContent"
  | "contact.addrCity"
  | "contact.addrCountry"
  | "contact.addrLine1"
  | "contact.addrLine2"
  | "contact.addrName"
  | "contact.addrPostcode"
  | "contact.address"
  | "contact.addressHint"
  | "contact.adminAddGuest"
  | "contact.adminAddressHint"
  | "contact.adminApprove"
  | "contact.adminApproved"
  | "contact.adminBlockedContact"
  | "contact.adminContactExists"
  | "contact.adminCopiedLink"
  | "contact.adminCopyLink"
  | "contact.adminCopyLinkNamed"
  | "contact.adminCreate"
  | "contact.adminDelete"
  | "contact.adminEdit"
  | "contact.adminEditGuest"
  | "contact.adminEmailChangeWarning"
  | "contact.adminEmailTaken"
  | "contact.adminGuestCancel"
  | "contact.adminInviteCopy"
  | "contact.adminInviteExpired"
  | "contact.adminInviteExpires"
  | "contact.adminInviteFailed"
  | "contact.adminInviteFor"
  | "contact.adminInviteKind"
  | "contact.adminInviteNoExpiry"
  | "contact.adminInviteNoTrips"
  | "contact.adminInviteNote"
  | "contact.adminInviteNotePlaceholder"
  | "contact.adminInvitePersonalTitle"
  | "contact.adminInviteRevoked"
  | "contact.adminInviteTrip"
  | "contact.adminInviteUses"
  | "contact.adminInviteWhichTrip"
  | "contact.adminLastSeen"
  | "contact.adminLinks"
  | "contact.adminNeedName"
  | "contact.adminNever"
  | "contact.adminNewInvite"
  | "contact.adminNoGuestTrip"
  | "contact.adminNone"
  | "contact.adminOther"
  | "contact.adminPending"
  | "contact.adminPostcardTo"
  | "contact.adminRevoke"
  | "contact.adminRevokeLink"
  | "contact.adminSignIn"
  | "contact.adminSubtitle"
  | "contact.adminTelHint"
  | "contact.adminTitle"
  | "contact.adminVia"
  | "contact.adminWants"
  | "contact.adminWantsDigest"
  | "contact.adminWantsPostcard"
  | "contact.code"
  | "contact.codeIntro"
  | "contact.codeServerError"
  | "contact.codeSubmit"
  | "contact.codeTitle"
  | "contact.codeWrong"
  | "contact.deleteHint"
  | "contact.deleteMe"
  | "contact.deleted"
  | "contact.doneBody"
  | "contact.doneTitle"
  | "contact.email"
  | "contact.emailHint"
  | "contact.error"
  | "contact.gone"
  | "contact.greeting"
  | "contact.intro"
  | "contact.language"
  | "contact.mailApprovedBody"
  | "contact.mailApprovedButton"
  | "contact.mailApprovedSubject"
  | "contact.mailApprovedTitle"
  | "contact.mailCodeBody"
  | "contact.mailCodeIgnore"
  | "contact.mailCodeSubject"
  | "contact.mailCodeTitle"
  | "contact.mailFooter"
  | "contact.mailManageButton"
  | "contact.mailRequestBody"
  | "contact.mailRequestButton"
  | "contact.mailRequestSubject"
  | "contact.mailRequestTitle"
  | "contact.manageIntro"
  | "contact.manageLink"
  | "contact.manageTitle"
  | "contact.name"
  | "contact.needAddress"
  | "contact.needEmail"
  | "contact.needName"
  | "contact.optional"
  | "contact.save"
  | "contact.saved"
  | "contact.startReading"
  | "contact.statusActive"
  | "contact.statusBlocked"
  | "contact.statusPending"
  | "contact.submit"
  | "contact.tel"
  | "contact.telHint"
  | "contact.title"
  | "contact.tooMany"
  | "contact.unsubscribe"
  | "contact.unsubscribed"
  | "contact.wantsDigest"
  | "contact.wantsPostcard"
  | "contact.welcomeBackBody"
  | "contact.welcomeBackTitle"
  | "contact.working"
  | "cost.amount"
  | "cost.beforeLeaving"
  | "cost.budget"
  | "cost.budgetDays"
  | "cost.budgetNote"
  | "cost.budgetNotePlanned"
  | "cost.budgetPerDay"
  | "cost.budgetPlan"
  | "cost.budgetSpent"
  | "cost.budgetTotal"
  | "cost.byCategory"
  | "cost.byCountry"
  | "cost.byCountryNote"
  | "cost.cat.accommodation"
  | "cost.cat.activities"
  | "cost.cat.flights"
  | "cost.cat.food"
  | "cost.cat.other"
  | "cost.cat.preparation"
  | "cost.cat.transport"
  | "cost.category"
  | "cost.cumulative"
  | "cost.cumulativeNote"
  | "cost.day"
  | "cost.disclaimer"
  | "cost.everyExpense"
  | "cost.hideTable"
  | "cost.noRate"
  | "cost.ofBudget"
  | "cost.onPace"
  | "cost.onTheRoad"
  | "cost.overBudget"
  | "cost.perDay"
  | "cost.perDayChart"
  | "cost.plannedSpend"
  | "cost.prep"
  | "cost.private"
  | "cost.projected"
  | "cost.remaining"
  | "cost.showTable"
  | "cost.spentIn"
  | "cost.subtitle"
  | "cost.subtitlePlanned"
  | "cost.title"
  | "cost.today"
  | "cost.total"
  | "cost.unconverted"
  | "cost.underBudget"
  | "cost.what"
  | "cost.when"
  | "currency.approxNote"
  | "currency.approxNoteUndated"
  | "currency.label"
  | "day.chooseDay"
  | "day.hideDays"
  | "day.label"
  | "day.lastDay"
  | "day.next"
  | "day.of"
  | "day.prev"
  | "day.today"
  | "day.update"
  | "day.updates"
  | "del.backups"
  | "del.confirmButton"
  | "del.deleteButton"
  | "del.doneJournalBody"
  | "del.doneJournalTitle"
  | "del.doneTripBody"
  | "del.doneTripTitle"
  | "del.expiredBody"
  | "del.expiredTitle"
  | "del.expiry"
  | "del.export"
  | "del.exportButton"
  | "del.exportHeading"
  | "del.failed"
  | "del.footer"
  | "del.goneBody"
  | "del.goneHome"
  | "del.goneNothingBody"
  | "del.goneTitle"
  | "del.goneTripBody"
  | "del.goneTripTitle"
  | "del.journalIntro"
  | "del.journalSubject"
  | "del.journalTitle"
  | "del.journalWhatGoes"
  | "del.keep"
  | "del.linkNote"
  | "del.notYou"
  | "del.pageLead"
  | "del.tripIntro"
  | "del.tripSubject"
  | "del.tripTitle"
  | "del.tripWhatGoes"
  | "del.usedBody"
  | "del.whatGoesHeading"
  | "del.working"
  | "digest.button"
  | "digest.footer"
  | "digest.greeting"
  | "digest.intro"
  | "digest.more"
  | "digest.moreOne"
  | "digest.preferences"
  | "digest.subject"
  | "digest.subjectOne"
  | "digest.title"
  | "digest.titleOne"
  | "draft.badge"
  | "draft.body"
  | "draft.title"
  | "err.aboutThisSite"
  | "err.allTrips"
  | "err.crashBody"
  | "err.crashTitle"
  | "err.dayGoneBody"
  | "err.dayGoneTitle"
  | "err.goToJournal"
  | "err.linkExpiredBody"
  | "err.linkExpiredTitle"
  | "err.notFoundTitle"
  | "err.notSignedInTitle"
  | "err.offlineBody"
  | "err.offlineTitle"
  | "err.pageGoneBody"
  | "err.pageGoneTitle"
  | "err.reference"
  | "err.retry"
  | "err.searchJournal"
  | "err.tripGoneBody"
  | "err.tripGoneTitle"
  | "err.unknownUserBody"
  | "err.unknownUserTitle"
  | "gallery.all"
  | "gallery.description"
  | "gallery.loadMore"
  | "gallery.none"
  | "gallery.subtitle"
  | "gallery.title"
  | "gate.askOwner"
  | "gate.privateBody"
  | "gate.privateTitle"
  | "gate.refusedBody"
  | "gate.refusedSeeAccess"
  | "gate.refusedTitle"
  | "gate.signInBody"
  | "hero.currentlyIn"
  | "hero.endedIn"
  | "hero.newSince"
  | "hero.newSinceOne"
  | "hero.over"
  | "hero.resume"
  | "hero.showNew"
  | "hero.startReading"
  | "hero.tagline"
  | "hero.timePerCountry"
  | "invite.buddyIntro"
  | "invite.buddyTitle"
  | "invite.confirmAs"
  | "invite.confirmSubmit"
  | "invite.expired"
  | "invite.guestIntro"
  | "invite.guestTitle"
  | "invite.inBody"
  | "invite.inTitle"
  | "invite.noMail"
  | "invite.notYet"
  | "invite.ownerBody"
  | "invite.ownerTitle"
  | "invite.submit"
  | "invite.waitingBody"
  | "invite.waitingTitle"
  | "landing.apiDocs"
  | "landing.copied"
  | "landing.copyInstruction"
  | "landing.docs"
  | "landing.handTitle"
  | "landing.hero"
  | "landing.instruction"
  | "landing.lede"
  | "landing.madeBy"
  | "landing.metaDescription"
  | "landing.metaTitle"
  | "landing.noEditor"
  | "landing.publicNone"
  | "landing.publicTitle"
  | "landing.readers"
  | "landing.readersBody"
  | "landing.selfHost"
  | "landing.selfHostBody"
  | "landing.source"
  | "landing.step1"
  | "landing.step1Body"
  | "landing.step2"
  | "landing.step2Body"
  | "landing.step3"
  | "landing.step3Body"
  | "landing.trips"
  | "landing.trips.one"
  | "lang.label"
  | "map.countries"
  | "map.countries.one"
  | "map.days"
  | "map.days.one"
  | "map.empty"
  | "map.everyStop"
  | "map.media"
  | "map.nextUp"
  | "map.places"
  | "map.planned"
  | "map.plannedFromDrafts"
  | "map.plannedHint"
  | "map.progress"
  | "map.readDay"
  | "map.reset"
  | "map.stillToCome"
  | "map.stops"
  | "map.stops.one"
  | "map.subtitle"
  | "map.subtitlePlanned"
  | "map.title"
  | "map.titlePlanned"
  | "map.zoomIn"
  | "map.zoomOut"
  | "me.agentBody"
  | "me.agentTitle"
  | "me.askOwner"
  | "me.askOwnerNamed"
  | "me.canRead"
  | "me.contacts"
  | "me.details"
  | "me.detailsBody"
  | "me.editDetails"
  | "me.handoverCopy"
  | "me.handoverCreate"
  | "me.handoverFailed"
  | "me.handoverReady"
  | "me.handoverWarning"
  | "me.handoverWorking"
  | "me.inviteBuddyBody"
  | "me.inviteBuddyTitle"
  | "me.inviteGuestBody"
  | "me.inviteGuestTitle"
  | "me.keysAgent"
  | "me.keysBody"
  | "me.keysHandover"
  | "me.keysRevoke"
  | "me.keysTitle"
  | "me.keysUntil"
  | "me.keysUnused"
  | "me.keysUsed"
  | "me.nothing"
  | "me.ownerNoTrips"
  | "me.ownerTitle"
  | "me.peopleBody"
  | "me.peopleTitle"
  | "me.signInAgain"
  | "me.signInBody"
  | "me.signInCode"
  | "me.signInEmail"
  | "me.signInSend"
  | "me.signInSending"
  | "me.signInSent"
  | "me.signInSubmit"
  | "me.signInTitle"
  | "me.signInWrong"
  | "me.signOut"
  | "me.signOutBody"
  | "me.signOutFailed"
  | "me.signOutTitle"
  | "me.signedInAs"
  | "me.signinExpired"
  | "me.signinThrottled"
  | "me.signingOut"
  | "me.strangerBody"
  | "me.strangerBodyNamed"
  | "me.strangerTitle"
  | "me.title"
  | "me.tokenBody"
  | "me.tokenTitle"
  | "me.tokenWarning"
  | "me.viaGuest"
  | "me.viaOwner"
  | "me.viaPublic"
  | "me.viaTraveller"
  | "media.count"
  | "meta.sectionOfTrip"
  | "nav.costs"
  | "nav.gallery"
  | "nav.map"
  | "nav.overview"
  | "nav.search"
  | "nav.signIn"
  | "nav.story"
  | "nav.toJournal"
  | "nav.trips"
  | "pager.back"
  | "pager.continue"
  | "pager.skip"
  | "push.blocked"
  | "push.enable"
  | "push.enabled"
  | "push.failed"
  | "push.install.body"
  | "push.install.dismiss"
  | "push.install.step1"
  | "push.install.step2"
  | "push.install.step3"
  | "push.install.title"
  | "push.iosInstall"
  | "push.turnOff"
  | "push.working"
  | "react.prompt"
  | "react.yours"
  | "search.error"
  | "search.noQuery"
  | "search.noResults"
  | "search.placeholder"
  | "search.subtitle"
  | "search.title"
  | "show.close"
  | "show.cutFull"
  | "show.cutNarrated"
  | "show.exitFullscreen"
  | "show.faster"
  | "show.fullscreen"
  | "show.next"
  | "show.pause"
  | "show.perSlide"
  | "show.play"
  | "show.prev"
  | "show.slower"
  | "show.start"
  | "signin.action"
  | "signin.body"
  | "signin.failed"
  | "signin.title"
  | "signin.working"
  | "stay.night"
  | "stay.nights"
  | "stay.sameDay"
  | "story.caughtUp"
  | "story.dayFailed"
  | "story.dayLoading"
  | "story.empty"
  | "story.tripEnd"
  | "test.body"
  | "test.title"
  | "trips.allTrips"
  | "trips.daysAway"
  | "trips.emptyOwnerBody"
  | "trips.emptyOwnerFilteredBody"
  | "trips.emptyOwnerFilteredTitle"
  | "trips.emptyTitle"
  | "trips.hiddenBody"
  | "trips.hiddenSignedInBody"
  | "trips.hiddenTitle"
  | "trips.lifetimeCountries"
  | "trips.lifetimeCountries.one"
  | "trips.lifetimeDays"
  | "trips.lifetimeDays.one"
  | "trips.lifetimePhotos"
  | "trips.lifetimeTrips"
  | "trips.lifetimeTrips.one"
  | "trips.malformedIdMismatch"
  | "trips.malformedIntro"
  | "trips.malformedIntro.one"
  | "trips.malformedInvalidId"
  | "trips.malformedMissingFields"
  | "trips.malformedMissingId"
  | "trips.malformedNoFile"
  | "trips.malformedTitle"
  | "trips.malformedTitle.one"
  | "trips.malformedUnparseable"
  | "trips.mapLabel"
  | "trips.noEntriesYet"
  | "trips.now"
  | "trips.oneDayAway"
  | "trips.past"
  | "trips.plannedBudget"
  | "trips.plannedRoute"
  | "trips.subtitle"
  | "trips.switch"
  | "trips.title"
  | "trips.today"
  | "trips.upcoming"
  | "welcome.addressNote"
  | "welcome.drafts"
  | "welcome.draftsHeading"
  | "welcome.draftsRule"
  | "welcome.footer"
  | "welcome.intro"
  | "welcome.linkNote"
  | "welcome.open"
  | "welcome.private"
  | "welcome.public"
  | "welcome.subject"
  | "welcome.title"
  | "welcome.token"
  | "welcome.tokenHeading";


/**
 * A translated string, with `{token}` placeholders filled from `vars`.
 *
 * Interpolation exists so that strings can refer to things that belong to the
 * instance rather than to the software — who is travelling, which currency
 * they budget in — without those values being baked into the dictionary.
 * An unknown token is left visible rather than blanked, so it shows up.
 *
 * `dictionary` is normally already the requested locale merged over English
 * (`dictionaryFor()` in lib/locales.ts does that merge), so most callers never
 * exercise `english` at all — it is there for callers that can tell the two
 * apart, so a miss that lands on English rather than on the requested locale
 * is a distinguishable, logged event rather than an invisible one
 * (`translateIn` is the one that does; see lib/locales.ts).
 *
 * This runs on every string of every render, so both checks below are a
 * property lookup and nothing more: no I/O, no allocation, on the path where
 * `dictionary` already has the answer.
 */
export function translate(
  dictionary: Record<string, string>,
  key: TranslationKey,
  vars?: Record<string, string>,
  english?: Record<string, string>,
): string {
  let raw: string | undefined = dictionary[key];
  if (raw === undefined) {
    raw = english?.[key];
    if (raw === undefined) {
      // Genuinely missing everywhere we know to look. A key rendered to a
      // reader — "nav.gallery" in place of a sentence — is certainly wrong
      // for everybody who sees it, so it is loud in the log rather than only
      // visible on the page (B279).
      console.error(`[i18n] "${key}" has no string in any dictionary — rendering the key.`);
      raw = key;
    } else {
      console.error(`[i18n] "${key}" is missing from the requested locale — using English.`);
    }
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

/** Month/weekday names per locale, so dates stay deterministic (never
 * `toLocaleDateString`, which differs between server and browser). */
const MONTHS: Record<string, string[]> = {
  en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
  de: ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],
  hu: ["január","február","március","április","május","június","július","augusztus","szeptember","október","november","december"],
};

const WEEKDAYS: Record<string, string[]> = {
  en: ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
  de: ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"],
  hu: ["vasárnap","hétfő","kedd","szerda","csütörtök","péntek","szombat"],
};

/** Dates stay deterministic — never `toLocaleDateString`, which differs
 * between server and browser. A locale we have no month names for reads its
 * dates in English rather than in numbers. */
export function monthNames(locale: string) {
  return MONTHS[locale] ?? MONTHS.en;
}
export function weekdayNames(locale: string) {
  return WEEKDAYS[locale] ?? WEEKDAYS.en;
}

/**
 * The singular of a counted string, when there is one.
 *
 * "1 trips" and "1 Countries" were both on the trips page, which is what a
 * language with two forms looks like when the code has none.
 *
 * A `<key>.one` entry beside the plural, and nothing more: these are counts of
 * days, countries and trips, and no language this project ships needs a third
 * form for them. Where a language does not inflect after a number at all —
 * Hungarian says "1 utazás" and "5 utazás" — its two entries simply hold the
 * same word, which keeps the rule in the dictionary where a translator can see
 * it rather than in a branch here.
 *
 * A missing `.one` falls back to the plural, so adding a count somewhere new
 * cannot break a language nobody has got to yet.
 */
export function plural(
  dictionary: Record<string, string>,
  key: TranslationKey,
  count: number,
  vars?: Record<string, string>,
  english?: Record<string, string>,
): string {
  const one = `${key}.one`;
  if (count === 1 && dictionary[one]) {
    return translate({ ...dictionary, [key]: dictionary[one] }, key, vars, english);
  }
  return translate(dictionary, key, vars, english);
}
