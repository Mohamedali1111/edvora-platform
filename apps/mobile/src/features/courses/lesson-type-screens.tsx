import type { ReactElement } from 'react';
import { LessonPlaceholder } from './components/lesson-placeholder';
import type { LessonType, StudentLessonSummary } from './course-types';

export type LessonTypeScreenProps = { lesson: StudentLessonSummary };
// A plain function returning a concrete ReactElement (not React's broader `FC`,
// whose return type also permits `Promise<ReactNode>` for async components) —
// lesson-screen.tsx invokes this directly as a function rather than as a JSX
// tag, which needs the narrower, always-synchronous return type here.
export type LessonTypeScreen = (props: LessonTypeScreenProps) => ReactElement;

/**
 * One real screen per Lesson type — this milestone's foundation for the later
 * slices that replace each of these with an actual player/viewer:
 *  - VIDEO  -> a future Video Lesson screen (Bunny Stream playback + the screen-
 *              capture protection architecture already documented in the auth
 *              milestone's report, neither implemented here)
 *  - DOCUMENT -> a future Document Lesson screen (R2 document viewer)
 *  - QUIZ   -> a future Quiz Lesson screen (attempt flow)
 * All three currently render the same honest "not implemented yet" placeholder
 * body (LessonPlaceholder) — kept as separate named components/registry entries
 * rather than one shared conditional so a later slice can replace exactly one
 * entry without touching the others or this dispatch itself.
 */
export const VideoLessonScreen: LessonTypeScreen = ({ lesson }) => <LessonPlaceholder lesson={lesson} />;
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
