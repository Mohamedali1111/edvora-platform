import { redirect } from "next/navigation";
import { legacyMediaDestination } from "@/features/instructor/library/library";

export function MediaPage() {
  redirect(legacyMediaDestination);
}
