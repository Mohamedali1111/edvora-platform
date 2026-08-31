import { InstructorApp } from "@/features/instructor/instructor-app";
import { toInstructorSection } from "@/features/instructor/navigation";

export default async function InstructorSectionPage({
  params,
}: {
  params: Promise<{ section?: string }>;
}) {
  const { section } = await params;

  return <InstructorApp section={toInstructorSection(section)} />;
}
