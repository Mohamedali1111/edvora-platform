import { redirect } from "next/navigation";
import { legacyMediaDestination } from "@/features/instructor/library/library";

export default function InstructorMediaPage() {
  redirect(legacyMediaDestination);
}
