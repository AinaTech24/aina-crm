import { Fraunces } from "next/font/google";

/** The public website's display face — a warm serif against the logo's crimson and teal. */
export const brandFont = Fraunces({ subsets: ["latin"], variable: "--font-brand", style: ["normal", "italic"], display: "swap" });
