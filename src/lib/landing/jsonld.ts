import { CONTACT, SITE_URL } from "@/lib/landing/links";

/**
 * Structured data (schema.org JSON-LD) for the public site. One source for the
 * organisation, so every page describes the company the same way — which is
 * what lets Google connect "AINA CRM" searches to this site.
 */

export const ORG_ID = `${SITE_URL}/#organization`;

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: CONTACT.company,
    alternateName: ["AINA CRM", "Aina CRM", "Aina Tech"],
    url: CONTACT.website,
    logo: `${SITE_URL}/aina-logo.png`,
    email: CONTACT.email,
    telephone: CONTACT.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: CONTACT.street,
      addressLocality: CONTACT.city,
      addressRegion: CONTACT.region,
      postalCode: CONTACT.postalCode,
      addressCountry: CONTACT.country,
    },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        telephone: CONTACT.phone,
        email: CONTACT.email,
        areaServed: "IN",
        availableLanguage: ["en", "hi", "gu"],
      },
    ],
  };
}

export function websiteLd() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: "AINA CRM",
    alternateName: ["Aina CRM", "AINA CRM for Mutual Fund Distributors"],
    publisher: { "@id": ORG_ID },
    inLanguage: "en-IN",
  };
}

export function softwareLd(description: string, features: string[]) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "AINA CRM",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "CRM software for Mutual Fund Distributors",
    operatingSystem: "Web",
    url: SITE_URL,
    description,
    featureList: features,
    publisher: { "@id": ORG_ID },
    offers: { "@type": "Offer", priceCurrency: "INR", price: "9499", url: `${SITE_URL}/#contact`, availability: "https://schema.org/InStock" },
  };
}

export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbLd(items: [string, string][]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE_URL}${path}` })),
  };
}

export function graph(...nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
