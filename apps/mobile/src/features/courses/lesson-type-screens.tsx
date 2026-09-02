import type { ReactElement } from 'react';
import { LessonPlaceholder } from './components/lesson-placeholder';
import type { LessonType, StudentLessonSummary } from './course-types';
import { VideoLessonScreen as RealVideoLessonScreen } from './video/video-lesson-screen';

export type LessonTypeScreenProps = {
  lesson: StudentLessonSummary;
  /** Needed by VIDEO to call /student/courses/:courseId/lessons/:lessonId/video/access. */
  courseId: string;
  /**
   * Re-fetches this lesson's data from Course Detail (the same call
   * lesson-screen.tsx already made to resolve this lesson) — the legitimate
   * "check again" action for a lesson-level state that can only change via a
   * fresh Course Detail read, e.g. VIDEO's `processingStatus` becoming READY.
   */
  onRetry: () => void;
};
// A plain function returning a concrete ReactElement (not React's broader `FC`,
// whose return type also permits `Promise<ReactNode>` for async components) —
// lesson-screen.tsx invokes this directly as a function rather than as a JSX
// tag, which needs the narrower, always-synchronous return type here.
export type LessonTypeScreen = (props: LessonTypeScreenProps) => ReactElement;

/**
 * One real screen per Lesson type:
 *  - VIDEO    -> real Bunny Stream HLS playback + screen-capture mitigation
 *                (see features/courses/video/) — implemented this milestone.
 *  - DOCUMENT -> still the placeholder (a future R2 document viewer slice).
 *  - QUIZ     -> still the placeholder (a future attempt-flow slice).
 * Kept as separate named components/registry entries rather than one shared
 * conditional so a later slice replaces exactly one entry without touching the
 * others or this dispatch itself.
 */
export const VideoLessonScreen: LessonTypeScreen = (props) => <RealVideoLessonScreen {...props} />;
export const DocumentLessonScreen: LessonTypeScreen = ({ lesson }) => <LessonPlaceholder lesson={lesson} />;
export const QuizLessonScreen: LessonTypeScreen = ({ lesson }) => <LessonPlaceholder lesson={lesson} />;

const LESSON_TYPE_SCREENS: Record<LessonType, LessonTypeScreen> = {
  VIDEO: VideoLessonScreen,
  DOCUMENT: DocumentLessonScreen,
  QUIZ: QuizLessonScreen,
};

// A lookup, not an if/else chain — the "clean type-routing architecture" this
// milestone establishes (§10). resolveLessonTypeScreen never falls back to a
// default: LessonType is an exhaustive backend enum (course-types.ts), so an
// unmatched value would only mean a genuinely new type the client doesn't know
// about yet, which lesson-type-routing.test.ts guards against silently drifting.
export function resolveLessonTypeScreen(type: LessonType): LessonTypeScreen {
  return LESSON_TYPE_SCREENS[type];
}
