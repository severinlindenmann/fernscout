/** The reader's appearance preference. It belongs to this browser, not to a journal. */
export const THEME_STORAGE_KEY = "fs.theme";
export const LIGHT_THEME_COLOR = "#ffd23f";
export const DARK_THEME_COLOR = "#171d29";

export const THEME_CHOICES = ["auto", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Storage contains explicit overrides only. Missing and malformed values are automatic. */
export function themeChoice(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "auto";
}

/** Keep the two media-qualified Next.js theme-colour tags aligned with an override. */
function syncThemeColour(choice: ThemeChoice) {
  const desired = choice === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const colour = meta.content.toLowerCase();
    if (choice === "auto") {
      meta.media = colour === DARK_THEME_COLOR ? "(prefers-color-scheme: dark)" : "(prefers-color-scheme: light)";
    } else {
      meta.media = colour === desired ? "all" : "not all";
    }
  });
}

export function applyThemeChoice(choice: ThemeChoice) {
  if (choice === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  syncThemeColour(choice);
}

/**
 * Runs in the document head before content paints. Keep this dependency-free:
 * it is serialised into the root layout rather than shipped as a hydrated
 * component, so an explicit choice can beat the first frame.
 */
export const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var r=document.documentElement;if(t==="light"||t==="dark"){r.setAttribute("data-theme",t)}else{t="auto";r.removeAttribute("data-theme")}var s=function(){var d=t==="dark"?"${DARK_THEME_COLOR}":"${LIGHT_THEME_COLOR}";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){var c=(m.content||"").toLowerCase();m.media=t==="auto"?(c==="${DARK_THEME_COLOR}"?"(prefers-color-scheme: dark)":"(prefers-color-scheme: light)"):(c===d?"all":"not all")})};if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",s,{once:true})}else{s()}}catch(e){}})()`;
