import { QuizDetail } from "@/features/instructor/quizzes/quiz-detail";

export default async function QuizDetailPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;

  return <QuizDetail quizId={quizId} />;
}
