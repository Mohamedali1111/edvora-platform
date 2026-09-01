import { InstructorDetail } from "@/features/admin/instructors/instructor-detail";

export default async function AdminInstructorDetailPage({
  params,
}: {
  params: Promise<{ instructorId: string }>;
}) {
  const { instructorId } = await params;
  return <InstructorDetail instructorId={instructorId} />;
}
