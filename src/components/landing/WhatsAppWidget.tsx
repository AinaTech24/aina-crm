import Script from "next/script";

/**
 * Vartify's floating WhatsApp chat button — on the public website only (the
 * homepage and the /solutions and /blog pages), never inside the CRM.
 * Loaded after the page is idle so it never delays the content.
 */
export function WhatsAppWidget() {
  return <Script src="https://vartify.in/widgets/whatsapp/PXRua10f8IKuAYNMWl4JuKnAeYh7BqSm.js" strategy="lazyOnload" />;
}
