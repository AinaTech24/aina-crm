import { PageSkeleton } from "@/components/common/Skeleton";

/**
 * Route-level loading state.
 *
 * Without one, Next holds the PREVIOUS screen on the router transition and the
 * app looks frozen until the server component's data lands — the reason
 * navigation felt unresponsive on most of the product. 11 of 254 routes had
 * this file; every route in the sidebar now does.
 */
export default function Loading() {
  return <PageSkeleton />;
}
