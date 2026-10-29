import { Plus_Jakarta_Sans } from "next/font/google";

/**
 * The public website's heading face — Plus Jakarta Sans, a clean geometric sans
 * (body text stays Inter, from the root layout). Weight and emphasis styling
 * for `.font-brand` live in globals.css ("Public website headings").
 */
export const brandFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-brand",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});
