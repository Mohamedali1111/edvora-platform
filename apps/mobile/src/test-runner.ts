// Zero-dependency test harness, mirroring apps/web/src/test-runner.ts exactly:
// Node's built-in `node:test` + `node:assert`, compiled to CommonJS by
// tsconfig.test.json and run directly with `node` — no Jest, no jest-expo, no
// React Native Testing Library. Deliberately scoped to pure, RN/Expo-import-free
// logic (see the milestone report's "Tests Added / Test Harness Assessment"
// section for what is and isn't covered this way).
import './features/auth/error-mapping.test';
import './features/auth/token-store.test';
import './features/auth/validate.test';
import './features/auth/activate-screen.source-guard.test';
import './features/device/device-context.source-guard.test';
import './features/device/device-status-mapping.test';
import './features/courses/capability-expiry.test';
import './features/courses/capture-protection/capture-state.test';
import './features/courses/content-access-recovery.test';
import './features/courses/document/document-error-mapping.test';
import './features/courses/document/document-mime.test';
import './features/courses/document/document-viewer-protocol.test';
import './features/courses/error-mapping.test';
import './features/courses/format.test';
import './features/courses/lesson-type-routing.test';
import './features/courses/pagination.test';
import './features/courses/progress-labels.test';
import './features/courses/quiz/quiz-answer-state.test';
import './features/courses/quiz/quiz-availability.test';
import './features/courses/quiz/quiz-error-mapping.test';
import './features/courses/quiz/quiz-result-format.test';
import './features/courses/video/processing-phase.test';
import './features/courses/video/video-error-mapping.test';
import './lib/api/errors.test';
import './lib/i18n/translations.test';
