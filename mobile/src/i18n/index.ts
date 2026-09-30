/**
 * Localisation foundation. English is the source of truth; Hindi and Gujarati
 * cover the app chrome (login, tabs, settings, Home greeting) as the first
 * slice — module screens still render English until their strings are moved
 * into `resources` below.
 *
 * Language follows the phone's setting by default; the user can pin one in
 * App preferences (device pref, see state/prefs). The hi/gu strings were
 * drafted in-house and should be reviewed by a native speaker before a
 * client-facing release.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";

export const LANGUAGES = [
  { code: "system", label: "Follow phone" },
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "gu", label: "ગુજરાતી" },
] as const;
export type LanguagePref = (typeof LANGUAGES)[number]["code"];
const SUPPORTED = new Set(["en", "hi", "gu"]);

export const resources = {
  en: {
    translation: {
      app: { name: "Aina CRM" },
      login: {
        subtitle: "Sign in to your account",
        codeSubtitle: "Enter your authentication code",
        email: "Email",
        password: "Password",
        code: "6-digit code",
        signIn: "Sign In",
        verify: "Verify",
        back: "Back to sign in",
        forgot: "Forgot password?",
        showPassword: "Show password",
        hidePassword: "Hide password",
        missing: "Enter your email and password.",
      },
      tabs: { home: "Home", tasks: "Tasks", settings: "Settings", leads: "Leads", clients: "Clients", activities: "Activities", more: "More" },
      home: { greeting: "Hi, {{name}}", planDay: "Plan your day", planDaySub: "Set today's focus & reflect" },
      settings: { title: "SETTINGS", signOut: "Sign out", signOutQ: "Sign out?", signOutMsg: "You'll need to log in again." },
      prefs: {
        title: "App preferences",
        subtitle: "Just for this device",
        language: "LANGUAGE",
        languageHint: "Applies to the app's own screens. Client data stays as your team entered it.",
      },
      common: { back: "Back", cancel: "Cancel", save: "Save", retry: "Try again" },
    },
  },
  hi: {
    translation: {
      app: { name: "Aina CRM" },
      login: {
        subtitle: "अपने खाते में साइन इन करें",
        codeSubtitle: "अपना प्रमाणीकरण कोड दर्ज करें",
        email: "ईमेल",
        password: "पासवर्ड",
        code: "6 अंकों का कोड",
        signIn: "साइन इन",
        verify: "सत्यापित करें",
        back: "साइन इन पर वापस जाएँ",
        forgot: "पासवर्ड भूल गए?",
        showPassword: "पासवर्ड दिखाएँ",
        hidePassword: "पासवर्ड छिपाएँ",
        missing: "अपना ईमेल और पासवर्ड दर्ज करें।",
      },
      tabs: { home: "होम", tasks: "कार्य", settings: "सेटिंग्स", leads: "लीड्स", clients: "क्लाइंट", activities: "गतिविधियाँ", more: "और" },
      home: { greeting: "नमस्ते, {{name}}", planDay: "अपना दिन प्लान करें", planDaySub: "आज का फ़ोकस तय करें और समीक्षा करें" },
      settings: { title: "सेटिंग्स", signOut: "साइन आउट", signOutQ: "साइन आउट करें?", signOutMsg: "आपको फिर से लॉग इन करना होगा।" },
      prefs: {
        title: "ऐप प्राथमिकताएँ",
        subtitle: "सिर्फ़ इस डिवाइस के लिए",
        language: "भाषा",
        languageHint: "ऐप की अपनी स्क्रीन पर लागू होता है। क्लाइंट डेटा वैसा ही रहता है जैसा आपकी टीम ने दर्ज किया।",
      },
      common: { back: "वापस", cancel: "रद्द करें", save: "सहेजें", retry: "फिर कोशिश करें" },
    },
  },
  gu: {
    translation: {
      app: { name: "Aina CRM" },
      login: {
        subtitle: "તમારા ખાતામાં સાઇન ઇન કરો",
        codeSubtitle: "તમારો પ્રમાણીકરણ કોડ દાખલ કરો",
        email: "ઈમેલ",
        password: "પાસવર્ડ",
        code: "6 અંકનો કોડ",
        signIn: "સાઇન ઇન",
        verify: "ચકાસો",
        back: "સાઇન ઇન પર પાછા જાઓ",
        forgot: "પાસવર્ડ ભૂલી ગયા?",
        showPassword: "પાસવર્ડ બતાવો",
        hidePassword: "પાસવર્ડ છુપાવો",
        missing: "તમારો ઈમેલ અને પાસવર્ડ દાખલ કરો.",
      },
      tabs: { home: "હોમ", tasks: "કાર્યો", settings: "સેટિંગ્સ", leads: "લીડ્સ", clients: "ક્લાયન્ટ", activities: "પ્રવૃત્તિઓ", more: "વધુ" },
      home: { greeting: "નમસ્તે, {{name}}", planDay: "તમારો દિવસ પ્લાન કરો", planDaySub: "આજનું ફોકસ નક્કી કરો અને સમીક્ષા કરો" },
      settings: { title: "સેટિંગ્સ", signOut: "સાઇન આઉટ", signOutQ: "સાઇન આઉટ કરવું છે?", signOutMsg: "તમારે ફરીથી લૉગ ઇન કરવું પડશે." },
      prefs: {
        title: "ઍપ પસંદગીઓ",
        subtitle: "ફક્ત આ ડિવાઇસ માટે",
        language: "ભાષા",
        languageHint: "ઍપની પોતાની સ્ક્રીન પર લાગુ પડે છે. ક્લાયન્ટ ડેટા તમારી ટીમે દાખલ કર્યો તેવો જ રહે છે.",
      },
      common: { back: "પાછળ", cancel: "રદ કરો", save: "સાચવો", retry: "ફરી પ્રયાસ કરો" },
    },
  },
} as const;

function resolve(pref: LanguagePref): string {
  if (pref !== "system") return pref;
  const sys = getLocales()[0]?.languageCode ?? "en";
  return SUPPORTED.has(sys) ? sys : "en";
}

let initialised = false;
export function initI18n(pref: LanguagePref = "system"): void {
  if (initialised) return;
  initialised = true;
  i18n.use(initReactI18next).init({
    resources,
    lng: resolve(pref),
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export function setLanguage(pref: LanguagePref): void {
  if (!initialised) initI18n(pref);
  else i18n.changeLanguage(resolve(pref));
}

export { i18n };
