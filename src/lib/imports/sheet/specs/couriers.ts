/** The Couriers import sheet — see ../spec.ts. Pure data. */
import {
  ALL_COURIER_STATUSES, COURIER_CATEGORIES, COURIER_LABELS, COURIER_STATUSES, COURIER_TYPES, PAYMENT_MODES,
} from "@/lib/couriers/entry";
import type { ColumnDef, SheetSpec } from "../spec";
import { MAX_IMPORT_ROWS } from "../spec";

const L = COURIER_LABELS;
const statuses = (t: "inward" | "outward") => COURIER_STATUSES[t].map((s) => s.label).join(", ");

const columns: ColumnDef[] = [
  { key: "courierType", header: L.courierType, required: true, kind: "enum", options: COURIER_TYPES, aliases: ["Type"], help: "Which way the courier went." },
  { key: "courierDate", header: L.courierDate, required: true, kind: "date", aliases: ["Date"], help: "The date of the courier." },
  { key: "courierCompany", header: L.courierCompany, kind: "text", aliases: ["Company", "Courier Service"], help: "Who carried it." },
  { key: "trackingNumber", header: L.trackingNumber, kind: "text", aliases: ["Tracking No", "AWB", "AWB Number", "Docket Number"], help: "The courier's tracking or docket number." },
  { key: "status", header: L.status, required: true, kind: "enum", options: ALL_COURIER_STATUSES, aliases: ["Status"], help: `Inward: ${statuses("inward")}. Outward: ${statuses("outward")}.` },
  { key: "category", header: L.category, kind: "enum", options: COURIER_CATEGORIES, aliases: ["Category"], help: "What kind of thing it is." },
  { key: "categoryOther", header: L.categoryOther, kind: "text", help: "Needed when the category is Other; otherwise leave blank." },
  { key: "description", header: L.description, kind: "longtext", aliases: ["Description", "Document Details"], help: "What is inside." },
  { key: "remarks", header: L.remarks, kind: "longtext", aliases: ["Notes", "Comments"], help: "Anything else." },
  { key: "senderName", header: L.senderName, kind: "text", help: "Inward only." },
  { key: "senderCompany", header: L.senderCompany, kind: "text", help: "Inward only." },
  { key: "senderMobile", header: L.senderMobile, kind: "text", help: "Inward only. 7 to 15 digits." },
  { key: "senderEmail", header: L.senderEmail, kind: "text", help: "Inward only." },
  { key: "senderAddress", header: L.senderAddress, kind: "longtext", help: "Inward only." },
  { key: "receivedDate", header: L.receivedDate, kind: "date", help: "Inward only." },
  { key: "recipientName", header: L.recipientName, kind: "text", help: "Outward only." },
  { key: "recipientCompany", header: L.recipientCompany, kind: "text", help: "Outward only." },
  { key: "recipientMobile", header: L.recipientMobile, kind: "text", help: "Outward only. 7 to 15 digits." },
  { key: "recipientEmail", header: L.recipientEmail, kind: "text", help: "Outward only." },
  { key: "recipientAddress", header: L.recipientAddress, kind: "longtext", help: "Outward only." },
  { key: "dispatchDate", header: L.dispatchDate, kind: "date", help: "Outward only." },
  { key: "courierCharges", header: L.courierCharges, kind: "text", aliases: ["Charges", "Amount"], help: "Outward only. In rupees, e.g. 120 or 120.50." },
  { key: "paymentMode", header: L.paymentMode, kind: "enum", options: PAYMENT_MODES, help: "Outward only." },
  { key: "deliveredDate", header: L.deliveredDate, kind: "date", help: "Outward only. Not earlier than the Dispatch Date." },
];

/** The tracking numbers of the example rows. They are refused on import, so an example can never be saved. */
export const EXAMPLE_TRACKING_NUMBERS = ["SAMPLE-INWARD-1", "SAMPLE-OUTWARD-2"] as const;

export const couriersSpec: SheetSpec = {
  entity: "couriers",
  label: "Couriers",
  singular: "courier",
  maxRows: MAX_IMPORT_ROWS,
  columns,
  examples: [
    {
      courierType: "Inward", courierDate: "24-11-2026", courierCompany: "Sample Courier", trackingNumber: EXAMPLE_TRACKING_NUMBERS[0],
      status: "Received", category: "KYC Documents", description: "Signed KYC forms", remarks: "Delete this example row",
      senderName: "Sample Sender", senderCompany: "Sample Company", senderMobile: "98765 43210", senderEmail: "sender@example.com",
      senderAddress: "12 Sample Road, Ahmedabad", receivedDate: "25-11-2026",
    },
    {
      courierType: "Outward", courierDate: "25-11-2026", courierCompany: "Sample Courier", trackingNumber: EXAMPLE_TRACKING_NUMBERS[1],
      status: "Delivered", category: "Other", categoryOther: "Gift hamper", remarks: "Delete this example row",
      recipientName: "Sample Recipient", recipientMobile: "91234 56780", recipientAddress: "4 Sample Street, Surat",
      dispatchDate: "25-11-2026", courierCharges: "120", paymentMode: "UPI", deliveredDate: "26-11-2026",
    },
  ],
  notes: [
    "Courier Type, Courier Date and Courier Status are required.",
    "An Inward row takes the Sender columns and Received Date; an Outward row takes the Recipient columns, Dispatch Date, charges, payment mode and Delivered Date. Leave the other side blank.",
    "Replace the two example rows (tracking numbers SAMPLE-INWARD-1 and SAMPLE-OUTWARD-2) with your own — they are never imported.",
  ],
};
